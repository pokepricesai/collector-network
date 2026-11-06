// CN-IDENTITY-01 · Discord link OAuth callback.
//
// The Account page kicks off supabase.auth.linkIdentity({ provider:
// 'discord' }) from the browser. Supabase handles the OAuth round
// trip and returns here with a ?code param, same as the main
// /auth/callback. We exchange the code (attaches Discord to the
// existing auth.users row) and then mirror the identity into our
// own collector_discord_links table via linkDiscordFromAuthIdentity.
//
// Error paths return to /account?discord=<code> so the Account page
// can surface a friendly message without ever exposing the OAuth
// error detail or a Discord ID in the URL.

import { NextResponse, type NextRequest } from 'next/server';
import {
  createServerSupabase,
  linkDiscordFromAuthIdentity,
} from '@collector-network/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    // Supabase returned the user WITH an error (e.g. user denied
    // the Discord consent). Return to Account with a generic flag.
    return NextResponse.redirect(new URL('/account?discord=denied', url.origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL('/account?discord=invalid', url.origin));
  }

  const supabase = await createServerSupabase();
  // Finalise the linkIdentity OAuth exchange. This writes the new
  // Discord identity into auth.identities on the EXISTING user.
  const { error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr) {
    return NextResponse.redirect(new URL(`/account?discord=exchange_failed`, url.origin));
  }

  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResp?.user) {
    return NextResponse.redirect(new URL('/account?discord=no_session', url.origin));
  }

  const result = await linkDiscordFromAuthIdentity(supabase, userResp.user.id);
  if (!result.ok) {
    const code = result.code === 'already_linked' ? 'already_linked'
      : result.code === 'no_discord_identity' ? 'no_discord_identity'
      : 'link_failed';
    return NextResponse.redirect(new URL(`/account?discord=${code}`, url.origin));
  }
  return NextResponse.redirect(new URL('/account?discord=connected', url.origin));
}
