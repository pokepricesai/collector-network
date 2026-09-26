// Resend transactional email transport.
//
// Wraps POST https://api.resend.com/emails. Never touches audience
// lists or contacts (that is CN-D territory). Adds tags so
// downstream analytics can distinguish auth from marketing.
//
// Injectable `fetch` for tests. Never logs API key, request body,
// tokens, or provider response bodies.
//
// Idempotency: the caller passes an `Idempotency-Key` derived from
// the Standard Webhooks event id and the dispatch variant, so
// Supabase retries do not fan out into duplicate sends.

import type { Brand } from './brand-registry.ts';
import type { EmailActionType } from './types.ts';

export interface SendInput {
  brand: Brand;
  action: EmailActionType;
  variant: 'default' | 'to_current' | 'to_new';
  toEmail: string;
  fromEmail: string;   // env-owned shared sender
  subject: string;
  html: string;
  text: string;
  // Optional. When present, sent as Resend's Idempotency-Key
  // header. Derive it from (event-id, variant) — never from a
  // token or a hash of one.
  idempotencyKey?: string;
}

export interface SendResult {
  ok: boolean;
  status: number;
  // Free-form error tag safe to log (no PII, no tokens, no
  // provider response body content).
  errorTag?: string;
}

// Deliberately narrow signature so tests can swap in a mock. The
// prod caller passes globalThis.fetch.
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export async function sendViaResend(
  apiKey: string,
  input: SendInput,
  doFetch: FetchLike = fetch,
): Promise<SendResult> {
  if (!apiKey) return { ok: false, status: 0, errorTag: 'missing-api-key' };
  if (!input.fromEmail) return { ok: false, status: 0, errorTag: 'missing-from-email' };
  if (!isPlausibleEmail(input.toEmail)) {
    return { ok: false, status: 0, errorTag: 'invalid-recipient' };
  }

  const body = {
    from: formatFromAddress(input.brand.senderName, input.fromEmail),
    to: [input.toEmail],
    subject: input.subject,
    html: input.html,
    text: input.text,
    // Resend tags: {name, value} pairs. Fixed vocabulary only.
    // Never carry a token, hash, user id or recipient email.
    tags: [
      { name: 'category', value: 'auth' },
      { name: 'brand', value: input.brand.siteCode },
      { name: 'action', value: input.action },
    ],
  };

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (input.idempotencyKey) {
    headers['Idempotency-Key'] = input.idempotencyKey;
  }

  let res: Response;
  try {
    res = await doFetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      errorTag: err instanceof Error ? `network:${err.name}` : 'network',
    };
  }

  if (res.status >= 200 && res.status < 300) {
    return { ok: true, status: res.status };
  }
  // Read text() defensively; discard content, only surface a tag
  // derived from status. The provider response body is NEVER
  // forwarded into our own response or logs.
  try { await res.text(); } catch { /* swallow */ }
  return { ok: false, status: res.status, errorTag: `resend-${res.status}` };
}

function isPlausibleEmail(v: string): boolean {
  if (typeof v !== 'string' || v.length < 3 || v.length > 320) return false;
  // Deliberately permissive; Resend does its own validation.
  const at = v.indexOf('@');
  return at > 0 && at < v.length - 1 && !/\s/.test(v);
}

// RFC 5322 name-addr formatting. Brand names come from the brand
// registry (app-owned constants), never from user input, but we
// still quote defensively so a future brand name containing a
// comma or dot cannot break the header.
function formatFromAddress(name: string, email: string): string {
  const needsQuoting = /[^A-Za-z0-9 ]/.test(name);
  const display = needsQuoting
    ? `"${name.replace(/["\\]/g, '\\$&')}"`
    : name;
  return `${display} <${email}>`;
}
