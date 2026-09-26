// Standard Webhooks HMAC verification for Supabase Send Email
// Hook. Supabase signs each hook call using the Standard Webhooks
// scheme (webhooks.standardwebhooks.com):
//
//   webhook-id, webhook-timestamp, webhook-signature headers.
//   signature = base64( HMAC_SHA256( secret_bytes,
//                                    id + '.' + timestamp + '.' + rawBody ) )
//   webhook-signature is `v1,<sig>` (multiple space-separated when
//   rotating secrets).
//
// The Supabase hook secret is stored as the literal string
// `v1,whsec_<base64>` and we strip the `v1,whsec_` prefix then
// base64-decode to get the raw HMAC key bytes.
//
// Uses only Web Crypto so it runs in Deno (Edge Function) AND
// Node (unit tests) without an environment fork.

export interface VerifyOptions {
  // Standard is 5 minutes; kept tight to make replay costly.
  toleranceSeconds?: number;
  // Injectable for tests. Defaults to Date.now() / 1000.
  nowSeconds?: () => number;
}

export type VerifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'missing-header'
        | 'bad-secret-format'
        | 'bad-signature-format'
        | 'timestamp-out-of-range'
        | 'signature-mismatch';
    };

// Public entrypoint. Given the raw request body + the three
// signing headers + the shared secret, return ok/false.
export async function verifyStandardWebhook(
  rawBody: string,
  headers: {
    id: string | null | undefined;
    timestamp: string | null | undefined;
    signature: string | null | undefined;
  },
  secret: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const id = headers.id;
  const ts = headers.timestamp;
  const sig = headers.signature;
  if (!id || !ts || !sig) return { ok: false, reason: 'missing-header' };

  const secretBytes = decodeSecret(secret);
  if (!secretBytes) return { ok: false, reason: 'bad-secret-format' };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'timestamp-out-of-range' };
  }
  const now = (opts.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  const tol = opts.toleranceSeconds ?? 5 * 60;
  if (Math.abs(now - tsNum) > tol) {
    return { ok: false, reason: 'timestamp-out-of-range' };
  }

  // The signed value is literally id + '.' + ts + '.' + body.
  const toSign = `${id}.${ts}.${rawBody}`;
  const expected = await hmacSha256Base64(secretBytes, toSign);

  // The header can carry multiple signatures separated by spaces
  // (e.g. during rotation). Match any.
  const candidates = sig.split(' ').map((s) => s.trim()).filter(Boolean);
  let anyMalformed = false;
  for (const c of candidates) {
    // Standard Webhooks format is `<version>,<signature>`.
    const idx = c.indexOf(',');
    if (idx < 0) {
      anyMalformed = true;
      continue;
    }
    const version = c.slice(0, idx);
    const provided = c.slice(idx + 1);
    if (version !== 'v1') continue; // ignore unknown versions
    if (constantTimeEqual(provided, expected)) return { ok: true };
  }
  return {
    ok: false,
    reason: anyMalformed && candidates.length === 0 ? 'bad-signature-format' : 'signature-mismatch',
  };
}

// Constant-time string compare so a timing side-channel cannot
// leak bytes of the expected signature.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Compute HMAC-SHA256 and return the standard base64 (with padding).
async function hmacSha256Base64(
  keyBytes: Uint8Array,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(message),
  );
  return base64Encode(new Uint8Array(sig));
}

// The Supabase hook secret is stored as `v1,whsec_<base64>`.
// Strip the prefix, decode the base64. Returns null on malformed
// input.
export function decodeSecret(raw: string): Uint8Array | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const cleaned = raw.replace(/^v1,/, '');
  const b64 = cleaned.startsWith('whsec_') ? cleaned.slice('whsec_'.length) : cleaned;
  if (b64.length === 0) return null;
  try {
    const bytes = base64Decode(b64);
    return bytes.length === 0 ? null : bytes;
  } catch {
    return null;
  }
}

// btoa/atob are available in Deno and Node 18+. Keep the helpers
// tiny + portable rather than pulling a base64 package.
function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}
function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
