// Request handler for the Send Email Hook. Testable in isolation
// via a mock fetch. The Deno.serve entry point is a thin wrapper
// that pulls env + calls handleHookRequest below.
//
// Flow:
//   1. Read raw body + hook headers.
//   2. Verify Standard-Webhooks signature.
//   3. Parse JSON.
//   4. Pick brand from email_data.redirect_to hostname.
//   5. Validate redirect target against known Collector Network
//      hostnames; fall back to brand.supportUrl if unknown.
//   6. Build action URL(s) using Supabase's verify pattern.
//   7. Render HTML + text.
//   8. Send via Resend (one or two emails depending on
//      email_change + Secure Email Change). Uses an idempotency
//      key derived from the Standard Webhooks event id + dispatch
//      variant so Supabase retries do not duplicate sends.
//   9. Return status 204 on success, 5xx on send failure so
//      Supabase retries.
//
// Never logs tokens, hashes, API keys or full request bodies.

import { brandForRedirectUrl, isKnownRedirectTarget, NEUTRAL_BRAND, type Brand } from './brand-registry.ts';
import { renderAuthEmail } from './render-email.ts';
import { sendViaResend, type FetchLike, type SendInput } from './resend-transport.ts';
import type { HookEmailData, HookPayload, RuntimeEnv } from './types.ts';
import { verifyStandardWebhook } from './verify-webhook.ts';

export interface HandleInput {
  rawBody: string;
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  };
  env: RuntimeEnv;
  doFetch?: FetchLike;
  // For tests: pin the wall clock so signature verification is
  // reproducible. Ignored in production.
  nowSeconds?: () => number;
}

export interface HandleOutput {
  status: number;
  // Response body kept short and non-sensitive. Never echoes back
  // tokens or hashes.
  body: string;
  // For observability: what got sent, tag-only.
  sent: Array<{ brand: string; action: string; variant: string; toDomain: string }>;
  errorTag?: string;
}

// Build the Supabase-verify action URL. We use the site_url from
// the payload (which is Supabase's own project URL, e.g.
// https://<ref>.supabase.co) plus the token_hash and action type.
// The redirect_to is only included if it resolves to a known
// Collector Network hostname; otherwise it falls back to the
// brand's supportUrl to avoid open-redirect abuse.
function buildActionUrl(
  emailData: HookEmailData,
  hash: string,
  brand: Brand,
): string {
  const base = emailData.site_url.replace(/\/+$/, '');
  const safeRedirect = isKnownRedirectTarget(emailData.redirect_to)
    ? emailData.redirect_to
    : brand.supportUrl;
  const params = new URLSearchParams({
    token: hash,
    type: emailData.email_action_type,
    redirect_to: safeRedirect,
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

interface QueuedSend {
  toEmail: string;
  hash: string;
  variant: 'default' | 'to_current' | 'to_new';
}

// Given the email_data + hook user, produce the list of emails
// we need to send. For most actions this is exactly one. For
// email_change with Secure Email Change enabled this is two:
//
//   • current inbox (user.email)     uses token_hash_new
//   • new inbox     (user.new_email) uses token_hash
//
// The naming is Supabase's compatibility artefact - see the
// CN-C spec for context.
export function planSends(payload: HookPayload): QueuedSend[] {
  const { user, email_data: ed } = payload;
  if (ed.email_action_type !== 'email_change') {
    return [{ toEmail: user.email, hash: ed.token_hash, variant: 'default' }];
  }
  const hasNew = !!ed.token_hash_new && !!ed.token_new;
  if (!hasNew) {
    // Secure Email Change disabled: single email, sent to the
    // caller-supplied recipient. Supabase sends to `user.email`
    // when SEC is off. Fall back defensively to new_email.
    const to = user.email || user.new_email;
    if (!to) return [];
    return [{ toEmail: to, hash: ed.token_hash, variant: 'default' }];
  }
  // Secure Email Change ON: two emails.
  const sends: QueuedSend[] = [];
  if (user.email) {
    sends.push({
      toEmail: user.email,
      hash: ed.token_hash_new!,
      variant: 'to_current',
    });
  }
  if (user.new_email) {
    sends.push({
      toEmail: user.new_email,
      hash: ed.token_hash,
      variant: 'to_new',
    });
  }
  return sends;
}

// Extract the recipient's email-domain suffix in a form that is
// safe to log. Never returns the full local part.
function domainOf(email: string): string {
  const at = email.indexOf('@');
  return at < 0 ? '(no-domain)' : email.slice(at + 1).toLowerCase();
}

export async function handleHookRequest(input: HandleInput): Promise<HandleOutput> {
  // 1. Signature verification. Never parse body first; the whole
  // point of the signature is to gate parsing.
  const verify = await verifyStandardWebhook(
    input.rawBody,
    input.headers,
    input.env.SEND_EMAIL_HOOK_SECRET,
    { nowSeconds: input.nowSeconds },
  );
  if (!verify.ok) {
    return {
      status: 401,
      body: 'invalid signature',
      sent: [],
      errorTag: `verify:${verify.reason}`,
    };
  }

  // 2. Parse payload. If malformed, fail without echoing content.
  let payload: HookPayload;
  try {
    payload = JSON.parse(input.rawBody) as HookPayload;
  } catch {
    return { status: 400, body: 'bad json', sent: [], errorTag: 'parse-json' };
  }
  if (!payload?.user || !payload?.email_data) {
    return { status: 400, body: 'missing fields', sent: [], errorTag: 'missing-fields' };
  }

  // 3. Brand detection from the redirect_to hostname. Never take
  // a brand identifier from the payload directly. Fall back to
  // NEUTRAL_BRAND if the redirect is unknown or malformed.
  const brand = brandForRedirectUrl(payload.email_data.redirect_to);

  // 4. Determine which sends we need.
  const sends = planSends(payload);
  if (sends.length === 0) {
    return {
      status: 400,
      body: 'no recipients',
      sent: [],
      errorTag: 'no-recipients',
    };
  }

  // 5. Render + send each. Any failure fails the whole hook so
  // Supabase retries the delivery.
  const summary: HandleOutput['sent'] = [];
  for (const s of sends) {
    const actionUrl = buildActionUrl(payload.email_data, s.hash, brand);
    const rendered = renderAuthEmail({
      brand,
      action: payload.email_data.email_action_type,
      variant: s.variant,
      actionUrl,
      recipientEmail: s.toEmail,
    });
    const sendPayload: SendInput = {
      brand,
      action: payload.email_data.email_action_type,
      variant: s.variant,
      toEmail: s.toEmail,
      fromEmail: input.env.AUTH_EMAIL_FROM_ADDRESS,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      // Standard Webhooks event id is a random per-event value from
      // Supabase; combining with the dispatch variant keeps the two
      // Secure Email Change sends distinct without leaking any
      // token/hash material into provider observability.
      idempotencyKey: input.headers.id
        ? `${input.headers.id}:${s.variant}`
        : undefined,
    };
    const result = await sendViaResend(
      input.env.RESEND_API_KEY,
      sendPayload,
      input.doFetch,
    );
    if (!result.ok) {
      return {
        status: 502,
        body: 'delivery failed',
        sent: summary,
        errorTag: result.errorTag ?? 'resend-unknown',
      };
    }
    summary.push({
      brand: brand.siteCode,
      action: payload.email_data.email_action_type,
      variant: s.variant,
      toDomain: domainOf(s.toEmail),
    });
  }

  // Neutral 204 body; never echoes the payload back.
  return { status: 204, body: '', sent: summary };
}

// Exported for tests that want to inspect brand fallback logic
// without going through the full request handler.
export { NEUTRAL_BRAND };

// Map a HandleOutput to a Fetch Response. Extracted so both the
// Deno entry and Node tests exercise the same code path.
//
// The 204 (No Content) status is a "null body status" per RFC 9110
// and the Fetch spec: the Response constructor throws
// `TypeError: Response with null body status cannot have body` if
// you pass ANY body value including an empty string. Success on
// this hook always returns 204, so callers that mistakenly pass
// `out.body` (an empty string) crash the Edge Function.
export function buildResponse(out: HandleOutput): Response {
  if (isNullBodyStatus(out.status)) {
    return new Response(null, { status: out.status });
  }
  return new Response(out.body, {
    status: out.status,
    headers: { 'content-type': 'text/plain' },
  });
}

function isNullBodyStatus(status: number): boolean {
  // Statuses that MUST NOT have a response body per the Fetch spec.
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}
