// Sign-out endpoint. Kept as a POST so a link click can't accidentally
// destroy the session (form.method=POST from the header dropdown).
// Redirects to the homepage on success.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/', request.url), { status: 303 });
}
