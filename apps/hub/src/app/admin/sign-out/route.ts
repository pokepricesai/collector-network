import { NextResponse, type NextRequest } from 'next/server';
import { createAdminServerSupabase } from '@/server/admin/supabase';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const sb = await createAdminServerSupabase();
  await sb.auth.signOut();
  return NextResponse.redirect(new URL('/admin/login', request.url), {
    status: 303,
  });
}
