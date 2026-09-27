// Safe return-URL handling. After sign-in/sign-up we redirect the
// user back to wherever they came from — never obey an open redirect.
// Normalises any user-supplied returnTo value to a same-origin path.

const DEFAULT_RETURN = '/account';

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
  if (decoded.length > 512) return DEFAULT_RETURN;
  return decoded;
}
