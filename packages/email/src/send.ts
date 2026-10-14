// Minimal Resend REST client. Avoids pulling the Resend SDK into the
// workspace (the webhook/receive side already exists in PokePrices).

import type { Brand } from './brand-registry';
import type { RenderedEmail } from './types';

export interface SendInput {
  brand: Brand;
  to: string;
  rendered: RenderedEmail;
  idempotencyKey: string;
  tags?: readonly { name: string; value: string }[];
  listUnsubscribeUrl?: string;
}

export interface SendResult {
  ok: true;
  id: string;
}
export interface SendFailure {
  ok: false;
  status?: number;
  error: string;
}

export async function sendViaResend(apiKey: string, input: SendInput): Promise<SendResult | SendFailure> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': input.idempotencyKey,
  };

  const body: Record<string, unknown> = {
    from: input.brand.fromAddress,
    to: [input.to],
    reply_to: input.brand.replyToAddress,
    subject: input.rendered.subject,
    html: input.rendered.html,
    text: input.rendered.text,
  };
  if (input.tags && input.tags.length > 0) body.tags = input.tags;
  if (input.listUnsubscribeUrl) {
    body.headers = {
      'List-Unsubscribe': `<${input.listUnsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: `fetch_failed: ${(err as Error).message}` };
  }

  const status = resp.status;
  let payload: unknown = null;
  try {
    payload = await resp.json();
  } catch {
    // non-JSON response
  }

  if (!resp.ok) {
    const message = typeof payload === 'object' && payload && 'message' in payload
      ? String((payload as { message: unknown }).message)
      : `resend_http_${status}`;
    return { ok: false, status, error: message };
  }

  const id = typeof payload === 'object' && payload && 'id' in payload
    ? String((payload as { id: unknown }).id)
    : '';
  if (!id) return { ok: false, status, error: 'resend_missing_id' };
  return { ok: true, id };
}
