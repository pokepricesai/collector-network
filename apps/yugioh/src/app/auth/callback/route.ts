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

    // CN-A membership + origin. Idempotent: the origin RPC only
    // acts if the user has no origin yet AND signup metadata
    // carries a known collector_origin_site. Both calls tolerate
    // failure without breaking the auth flow.
    try {
      await recordOriginFromSignup(supabase);
      await recordSiteAuthentication(supabase, YGO_SITE_CODE);
    } catch (err) {
      console.error('[yugioh/auth-callback] CN-A membership rpc failed', err);
    }
  }
  return NextResponse.redirect(dest);
}
