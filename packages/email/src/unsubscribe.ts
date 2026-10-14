import { createHmac, timingSafeEqual } from 'node:crypto';

// Token format: base64url("<user_id>.<site_code>.<kind>.<signature>")
// where signature = HMAC-SHA256(secret, "<user_id>.<site_code>.<kind>").

export type UnsubscribeKind = 'site' | 'network';

export interface UnsubscribeToken {
  userId: string;
  siteCode: string;
  kind: UnsubscribeKind;
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64');
}

function sign(secret: string, payload: string): string {
  return b64urlEncode(createHmac('sha256', secret).update(payload).digest());
}

export function createUnsubscribeToken(secret: string, token: UnsubscribeToken): string {
  const payload = `${token.userId}.${token.siteCode}.${token.kind}`;
  const sig = sign(secret, payload);
  return b64urlEncode(Buffer.from(`${payload}.${sig}`, 'utf8'));
}

export function verifyUnsubscribeToken(secret: string, raw: string): UnsubscribeToken | null {
  let decoded: string;
  try {
    decoded = b64urlDecode(raw).toString('utf8');
  } catch {
    return null;
  }
  const parts = decoded.split('.');
  if (parts.length !== 4) return null;
  const [userId, siteCode, kind, sig] = parts;
  if (!userId || !siteCode || !kind || !sig) return null;
  if (kind !== 'site' && kind !== 'network') return null;
  const expected = sign(secret, `${userId}.${siteCode}.${kind}`);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return { userId, siteCode, kind: kind as UnsubscribeKind };
}

export function unsubscribeUrl(baseUrl: string, secret: string, token: UnsubscribeToken): string {
  const t = createUnsubscribeToken(secret, token);
  const url = new URL('/unsubscribe', baseUrl);
  url.searchParams.set('t', t);
  return url.toString();
}

export function managePreferencesUrl(baseUrl: string): string {
  return new URL('/email-preferences', baseUrl).toString();
}
