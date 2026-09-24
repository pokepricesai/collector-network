// Safe return-URL handling. After sign-in/sign-up we redirect the
// user back to wherever they came from — but we must never obey an
// open redirect. This module normalises any user-supplied returnTo
// value to a same-origin, in-app path.

const DEFAULT_RETURN = '/account';

// Only allow relative paths that start with '/', are not '//' (which
// browsers treat as protocol-relative → open redirect), and don't
// point at auth surfaces (would loop).
const AUTH_SURFACES = new Set(['/sign-in', '/sign-up', '/auth/callback']);

export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_RETURN;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_RETURN;
  }
  if (typeof decoded !== 'string') return DEFAULT_RETURN;
  if (!decoded.startsWith('/')) return DEFAULT_RETURN;
  if (decoded.startsWith('//')) return DEFAULT_RETURN;
  if (decoded.startsWith('/\\')) return DEFAULT_RETURN;
  if (AUTH_SURFACES.has(decoded.split('?')[0]!)) return DEFAULT_RETURN;
  // Cap length so a pathological URL cannot fill the redirect header.
  if (decoded.length > 512) return DEFAULT_RETURN;
  return decoded;
}
