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
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL('/sign-in?returnTo=/account', 'http://x').toString(), { status: 303 });
  const supabase = await createServerSupabase();
  const result = await unlinkDiscord(supabase, user.id);
  const flag = result.ok ? 'disconnected' : 'disconnect_failed';
  // 303 → browser follows as GET.
  return NextResponse.redirect(new URL(`/account?discord=${flag}`, process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://onepieceprices.io').toString(), { status: 303 });
}
