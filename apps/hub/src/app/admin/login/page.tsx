import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createAdminServerSupabase } from '@/server/admin/supabase';
import { getCurrentAdmin } from '@/server/admin/require-admin';
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const sp = await searchParams;
  // If the caller is already an admin, skip the form.
  const current = await getCurrentAdmin();
  if (current.ok) {
    const next = safeReturn(sp.returnTo);
    redirect(next);
  }

  const errorMessage =
    sp.error === 'denied'
      ? 'That account is not permitted here.'
      : sp.error === 'invalid'
      ? 'Email or password incorrect.'
      : sp.error === 'unavailable'
      ? 'Admin backend is temporarily unavailable.'
      : null;

  return (
    <div className="admin-auth-root">
      <div className="admin-auth-card">
        <h1>Collector Network OS</h1>
        <p>Admin sign in.</p>
        {errorMessage && <div className="admin-auth-error" role="alert">{errorMessage}</div>}
        <LoginForm returnTo={safeReturn(sp.returnTo)} />
      </div>
    </div>
  );
}

function safeReturn(raw: string | undefined): string {
  if (!raw) return '/admin';
  try {
    const decoded = decodeURIComponent(raw);
    if (!decoded.startsWith('/admin')) return '/admin';
    if (decoded.startsWith('/admin/login') || decoded.startsWith('/admin/sign-out')) return '/admin';
    if (decoded.length > 256) return '/admin';
    return decoded;
  } catch {
    return '/admin';
  }
}
