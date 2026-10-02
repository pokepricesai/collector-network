import 'server-only';

// Server-side admin authorisation guard. Two layers:
//
//   1. There must be an authenticated Supabase session.
//   2. The session user must have an ACTIVE row in
//      public.network_admin_users.
//
// Both layers must pass. A regular consumer-site session that
// shares the same Supabase project is not admin — RLS on the
// network_admin_users table (plus the explicit is_active check)
// ensures the SELECT returns zero rows for them.
//
// Call `requireAdmin()` at the top of every /admin server render
// and server action. Never rely on hidden routes for security.

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminServerSupabase } from './supabase';

export interface AdminIdentity {
  authUserId: string;
  email: string;
  displayName: string | null;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  isActive: boolean;
  adminRowId: string;
}

export async function getCurrentAdmin(): Promise<
  { ok: true; admin: AdminIdentity; sb: SupabaseClient }
  | { ok: false; reason: 'no-session' | 'not-admin' | 'db-error'; sb: SupabaseClient }
> {
  const sb = await createAdminServerSupabase();
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) {
    return { ok: false, reason: 'no-session', sb };
  }
  const user = userData.user;
  const { data: row, error: rowErr } = await sb
    .from('network_admin_users')
    .select('id, auth_user_id, email, display_name, role, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (rowErr) {
    return { ok: false, reason: 'db-error', sb };
  }
  if (!row || row.is_active !== true) {
    return { ok: false, reason: 'not-admin', sb };
  }
  return {
    ok: true,
    sb,
    admin: {
      authUserId: row.auth_user_id as string,
      email: row.email as string,
      displayName: (row.display_name as string | null) ?? null,
      role: row.role as AdminIdentity['role'],
      isActive: true,
      adminRowId: row.id as string,
    },
  };
}

/** Enforces admin access. Redirects to /admin/login (unauth)
 *  or /admin/denied (authenticated but not admin). Never returns
 *  on failure. */
export async function requireAdmin(
  currentPath = '/admin',
): Promise<{ admin: AdminIdentity; sb: SupabaseClient }> {
  const r = await getCurrentAdmin();
  if (r.ok) return { admin: r.admin, sb: r.sb };
  if (r.reason === 'no-session') {
    const returnTo = encodeURIComponent(currentPath);
    redirect(`/admin/login?returnTo=${returnTo}`);
  }
  if (r.reason === 'not-admin') {
    redirect('/admin/denied');
  }
  redirect('/admin/login?error=unavailable');
  // Unreachable but satisfies TS narrowing.
  throw new Error('unreachable');
}
