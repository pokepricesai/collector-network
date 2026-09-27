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

const OP_SITE_CODE = 'onepiece';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
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
      await recordSiteAuthentication(supabase, OP_SITE_CODE);
    } catch (err) {
      console.error('[onepiece/auth-callback] CN membership rpc failed', err);
    }
  }
  return NextResponse.redirect(dest);
}
