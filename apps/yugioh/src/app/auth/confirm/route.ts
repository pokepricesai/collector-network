// First-party auth-confirmation route. Every transactional email
// the CN-C edge function sends (signup / recovery / magiclink /
// email_change / invite / reauthentication) points at this URL.
//
// Flow:
//   1. Read token_hash + type + next from the query string.
//   2. Validate type against ALLOWED_OTP_TYPES + sanitise next
//      (safeConfirmNext rejects protocol-relative, absolute, and
//      /auth/* paths).
//   3. Create the SSR server client (same one AuthForm uses).
//   4. supabase.auth.verifyOtp({token_hash, type}) — writes the
//      session cookies through the SSR helper's cookie adapter.
//   5. Best-effort fire the CN-A/CN-B membership + consent RPCs
//      (mirror of /auth/callback so first-authenticated_at is
//      recorded on email-confirmation signups too).
//   6. Redirect to the sanitised `next`. The final URL contains
//      no token_hash / type / next parameters.
//
// Failure paths redirect to /sign-in with a friendly error tag so
// the raw Supabase error message never lands in the URL bar.
//
// See supabase/functions/_shared/handle-request.ts for the mirror
// side of this contract (action → type mapping + URL builder).

import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import {
  applySignupMarketingConsent,
  createServerSupabase,
  recordOriginFromSignup,
  recordSiteAuthentication,
} from '@collector-network/auth';
import { parseConfirmSearchParams } from '../../../lib/confirm-params';

export const dynamic = 'force-dynamic';

const YGO_SITE_CODE = 'ygo';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const parsed = parseConfirmSearchParams(url.searchParams);

  if (!parsed.ok) {
    const fail = new URL('/sign-in', url.origin);
    fail.searchParams.set('error', `confirm-${parsed.error}`);
    return NextResponse.redirect(fail);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: parsed.tokenHash,
    // The SDK's EmailOtpType union permits arbitrary strings via
    // its (string & {}) fallback; parsed.type was validated
    // against our own allowlist so this cast is safe.
    type: parsed.type as EmailOtpType,
  });

  if (error) {
    const fail = new URL('/sign-in', url.origin);
    fail.searchParams.set('error', 'confirm-failed');
    return NextResponse.redirect(fail);
  }

  // CN-A + CN-B membership + origin + signup consent, mirror of
  // /auth/callback. All three RPCs are idempotent replay-safe.
  // Failure never breaks the auth flow — next auth event retries.
  try {
    await recordOriginFromSignup(supabase);
    await applySignupMarketingConsent(supabase);
    await recordSiteAuthentication(supabase, YGO_SITE_CODE);
  } catch (err) {
    console.error('[yugioh/auth-confirm] CN membership rpc failed', err);
  }

  // Success: build a fresh URL from the sanitised path. token_hash
  // / type / next are dropped from the final URL — the address
  // bar shows only the app path.
  return NextResponse.redirect(new URL(parsed.next, url.origin));
}
