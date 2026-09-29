// apps/onepiece/src/app/account/reset-password/page.tsx
//
// Password-reset landing. Sends the user through the shared Supabase
// auth flow — we do not implement our own password logic. The user
// receives an email with a link back to the same domain / callback.

import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser, createServerSupabase } from '@collector-network/auth';
import { canonicalFor, SITE_ORIGIN } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
  alternates: { canonical: canonicalFor('/account/reset-password') },
};

async function sendReset(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return;
  const supabase = await createServerSupabase();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_ORIGIN}/auth/callback?next=/settings`,
  });
}

export default async function ResetPasswordPage({ searchParams }: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const sent = params.sent === '1';

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Reset password</div>
      <h1 style={{ margin: '6px 0 8px', fontSize: 26 }}>Send a reset email</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
        Enter the email on your Collector Network account and we&apos;ll send
        a secure link to set a new password.
      </p>

      {sent ? (
        <div style={{
          marginTop: 22, padding: 18, background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: 12, fontSize: 14, lineHeight: 1.55,
        }}>
          If an account with that email exists, a password-reset link is on
          its way. Check spam if it doesn&apos;t arrive within a minute.{' '}
          <Link href="/sign-in" style={{ fontWeight: 700 }}>Return to sign in</Link>.
        </div>
      ) : (
        <form
          action={async (fd) => {
            'use server';
            await sendReset(fd);
          }}
          method="post"
          style={{ marginTop: 22, display: 'grid', gap: 10 }}
        >
          <input
            type="email"
            name="email"
            required
            defaultValue={user?.email ?? ''}
            placeholder="you@example.com"
            style={{
              padding: '10px 12px', fontSize: 14,
              borderRadius: 8, border: '1px solid var(--border-strong, var(--border))',
              background: 'var(--bg-light)', color: 'var(--text)',
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button
            type="submit"
            formAction="/account/reset-password?sent=1"
            style={{
              padding: '11px 16px', borderRadius: 8,
              background: 'linear-gradient(135deg, var(--ocean-400) 0%, var(--ocean-500) 100%)',
              color: 'var(--palette-white)',
              border: '1px solid var(--primary)',
              fontFamily: 'inherit', fontWeight: 800, fontSize: 13,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(9,55,134,0.20)',
            }}
          >Send reset email</button>
          <Link href="/settings" style={{ fontSize: 12, color: 'var(--text-muted)' }}>← Back to settings</Link>
        </form>
      )}
    </div>
  );
}
