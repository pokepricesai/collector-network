// OAuth + email-confirmation callback. Supabase redirects here with
// a `code` query param; we exchange it for a session (cookies are
// written by the server client), then forward to the caller-supplied
// return path.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';
import { safeReturnTo } from '../../../lib/return-to';

export const dynamic = 'force-dynamic';

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
  }
  return NextResponse.redirect(dest);
}
