// CN-IDENTITY-01 · Discord disconnect endpoint.
//
// POST only. The Account page's Disconnect button submits a form
// here; we flip the collector_discord_links row to disconnected
// and best-effort unlink the Discord identity from auth.identities.
// The user retains their core Supabase session + membership — this
// only severs the Discord association.

import { NextResponse } from 'next/server';
import {
  createServerSupabase,
  getCurrentUser,
  unlinkDiscord,
} from '@collector-network/auth';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const siteUrl = process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://ygoprices.io';
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL('/sign-in?returnTo=/account', siteUrl).toString(), { status: 303 });
  }
  const supabase = await createServerSupabase();
  const result = await unlinkDiscord(supabase, user.id);
  // Distinct flag per failure mode so the Account page can surface
  // a specific message. The identity_removal_failed case is the
  // important one: user must see that Discord is still attached so
  // they know to retry.
  let flag: string;
  if (result.ok) {
    flag = 'disconnected';
  } else if (result.code === 'identity_removal_failed') {
    flag = 'identity_removal_failed';
  } else if (result.code === 'not_authenticated') {
    flag = 'no_session';
  } else {
    flag = 'disconnect_failed';
  }
  return NextResponse.redirect(new URL(`/account?discord=${flag}`, siteUrl).toString(), { status: 303 });
}
