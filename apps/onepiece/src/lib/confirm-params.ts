// Parses + validates inputs to the /auth/confirm route.
//
// Extracted from the route handler so the logic is testable
// under node --test without a full Next.js runtime. The route
// handler is a thin wrapper that pulls the URL, delegates to
// this module, then calls supabase.auth.verifyOtp.

import { safeReturnTo } from './return-to';

// Every value that the CN-C edge function is allowed to emit as
// `type=`. Matches the ACTION_MAPPING in
// supabase/functions/_shared/handle-request.ts. Anything outside
// this set is rejected at the confirm route boundary.
export const ALLOWED_OTP_TYPES = new Set([
  'email',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
  'reauthentication',
] as const);

export type AllowedOtpType = 'email' | 'magiclink' | 'recovery' | 'invite' | 'email_change' | 'reauthentication';

export type ParseConfirmResult =
  | { ok: true; tokenHash: string; type: AllowedOtpType; next: string }
  | { ok: false; error: 'missing-token' | 'invalid-type' };

// Strict `next` sanitiser: builds on safeReturnTo (rejects
// protocol-relative, absolute, auth surfaces, oversize) and also
// rejects any `/auth/*` prefix so a hostile link cannot bounce a
// verified session back through the confirm route.
export function safeConfirmNext(raw: string | null | undefined): string {
  const r = safeReturnTo(raw);
  if (r.startsWith('/auth/')) return '/account';
  return r;
}

export function parseConfirmSearchParams(sp: URLSearchParams): ParseConfirmResult {
  const tokenHash = sp.get('token_hash');
  const type = sp.get('type');
  const nextRaw = sp.get('next');

  if (!tokenHash || typeof tokenHash !== 'string' || tokenHash.length === 0) {
    return { ok: false, error: 'missing-token' };
  }
  if (!type || !ALLOWED_OTP_TYPES.has(type as AllowedOtpType)) {
    return { ok: false, error: 'invalid-type' };
  }
  return {
    ok: true,
    tokenHash,
    type: type as AllowedOtpType,
    next: safeConfirmNext(nextRaw),
  };
}
