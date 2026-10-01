// OAuth + email-confirmation callback. Supabase redirects here with
// a `code` param; we exchange it for a session and forward to the
// caller-supplied return path.
//
// CN-A + CN-B: on every successful auth exchange we fire the three
// membership/consent RPCs. All idempotent replay-safe; failure never
// breaks the auth flow — the next auth event retries.

import { NextResponse, type NextRequest } from 'next/server';
import {
  applySignupMarketingConsent,
  createServerSupabase,
  recordOriginFromSignup,
  recordSiteAuthentication,
} from '@collector-network/auth';
import { safeReturnTo } from '../../../lib/return-to';

export const dynamic = 'force-dynamic';

const LC_SITE_CODE = "lorcana";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  // `next` is the Supabase template-default name for the post-auth
  // return path (reset-password email). Accept either and run both
  // through safeReturnTo so neither can carry an external URL.
  const rawReturn =
    url.searchParams.get('returnTo') ?? url.searchParams.get('next');
  const returnTo = safeReturnTo(rawReturn);
  // ALWAYS build the destination against *this* request's origin so a
  // post-auth redirect can never cross-site, even if the Supabase email
  // template contained a stale/different origin.
  const dest = new URL(returnTo, url.origin);

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const failUrl = new URL('/sign-in', url.origin);
      failUrl.searchParams.set('returnTo', returnTo);
      failUrl.searchParams.set('error', 'callback-failed');
      return NextResponse.redirect(failUrl);
    }

    try {
      await recordOriginFromSignup(supabase);
      await applySignupMarketingConsent(supabase);
      await recordSiteAuthentication(supabase, LC_SITE_CODE);
    } catch (err) {
      console.error('[lorcana/auth-callback] CN membership rpc failed', err);
    }
  }
  return NextResponse.redirect(dest);
}
