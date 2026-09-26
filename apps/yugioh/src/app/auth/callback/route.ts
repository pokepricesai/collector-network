// OAuth + email-confirmation callback. Supabase redirects here with
// a `code` query param; we exchange it for a session (cookies are
// written by the server client), then forward to the caller-supplied
// return path.
//
// CN-A: on every successful auth exchange we also fire the two
// Collector Network membership RPCs so:
//   • YGO membership row exists / bumps last_seen + first_auth
//   • Origin gets attributed IF and only IF the caller's own signup
//     metadata carries a valid collector_origin_site AND no origin
//     row already exists. Existing accounts with no such metadata
//     stay origin-null forever.
//
// Neither RPC is allowed to break the auth flow. If either fails we
// still redirect the user through - the DB failure is logged
// server-side and the next auth event retries.

import { NextResponse, type NextRequest } from 'next/server';
import {
  applySignupMarketingConsent,
  createServerSupabase,
  recordOriginFromSignup,
  recordSiteAuthentication,
} from '@collector-network/auth';
import { safeReturnTo } from '../../../lib/return-to';

export const dynamic = 'force-dynamic';

const YGO_SITE_CODE = 'ygo';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
  const dest = new URL(returnTo, url.origin);

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Redirect back to sign-in with a friendly message rather than
      // dumping the raw error into the URL.
      const failUrl = new URL('/sign-in', url.origin);
      failUrl.searchParams.set('returnTo', returnTo);
      failUrl.searchParams.set('error', 'callback-failed');
      return NextResponse.redirect(failUrl);
    }

    // CN-A + CN-B membership + origin + signup consent. All three
    // RPCs are idempotent replay-safe. Failure of any single call
    // never breaks the auth flow - the next auth event retries.
    //   • record_origin_from_signup: sets originated_here only
    //     if the immutable snapshot carries a known origin site
    //     AND no origin row exists yet.
    //   • apply_signup_marketing_consent: writes site/network
    //     preference + event ONLY if intent captured at signup
    //     AND no preference row for that scope exists.
    //   • record_site_authentication: creates/refreshes the YGO
    //     membership row for this shared user.
    try {
      await recordOriginFromSignup(supabase);
      await applySignupMarketingConsent(supabase);
      await recordSiteAuthentication(supabase, YGO_SITE_CODE);
    } catch (err) {
      console.error('[yugioh/auth-callback] CN membership rpc failed', err);
    }
  }
  return NextResponse.redirect(dest);
}
