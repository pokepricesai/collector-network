// apps/lorcana/src/app/settings/page.tsx
//
// Editable user settings. Modelled on MTGPrices' /settings layout with
// sections stacked vertically:
//   Account     email + sign-out
//   Password    reset-password link
//   Danger zone delete-account (soft — signs out + advisory)
//
// Reuses the shared @collector-network/auth pipeline. No per-app auth.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import { canonicalFor } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'LorcanaPrices settings.',
  alternates: { canonical: canonicalFor('/settings') },
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/settings');

  return (
    <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono">Settings</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 6, lineHeight: 1.55 }}>
        Manage your LorcanaPrices account and identity. One Collector
        Network login covers Yu-Gi-Oh, One Piece and Lorcana — changes
        apply everywhere.
      </p>

      {/* Account identity */}
      <section id="account" style={{
        marginTop: 22, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--ink-amethyst-ink, #2A1462)' }}>Account</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Sign in and identity</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Your sign in identity is shared with the wider Collector Network.
          Changing your email or password here applies everywhere.
        </p>
        <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-light)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13 }}>
          <div><strong>Email</strong> {user.email ?? 'no email on file'}</div>
          {user.created_at && (
            <div style={{ marginTop: 4 }}><strong>Joined</strong> {new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              className="btn btn-sm btn-ghost"
              style={{
                padding: '9px 14px',
                borderRadius: 8,
                background: 'var(--surface)',
                color: 'var(--text)',
                border: '1px solid var(--border-strong, var(--border))',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </section>

      {/* Password */}
      <section id="password" style={{
        marginTop: 18, padding: 22, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--ink-amethyst-ink, #2A1462)' }}>Password</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Change password</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Password reset is delivered by email through the shared
          Collector Network auth pipeline.
        </p>
        <div style={{ marginTop: 12 }}>
          <Link href="/account/reset-password" className="btn btn-sm btn-primary">Reset password</Link>
        </div>
      </section>

      {/* Danger zone */}
      <section id="danger" style={{
        marginTop: 18, padding: 22, background: 'var(--surface)',
        border: '1px solid rgba(193,56,73,0.35)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8, color: '#C13849' }}>Danger zone</div>
        <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-strong)' }}>Delete account</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Deletes your LorcanaPrices collection holdings and revokes this
          account&apos;s access to the shared Collector Network. If your
          identity is shared with other sites you will lose access
          there too. This action cannot be undone.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55 }}>
          Delete-account is currently handled by contacting support so we
          can confirm the shared-identity impact before the deletion runs.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={`mailto:hello@lorcanaprices.io?subject=${encodeURIComponent('Delete my LorcanaPrices account')}&body=${encodeURIComponent(`Please delete the account associated with ${user.email ?? 'my email'}.`)}`}
            className="btn btn-sm"
            style={{
              padding: '9px 14px',
              borderRadius: 8,
              background: 'transparent',
              color: '#C13849',
              border: '1px solid rgba(193,56,73,0.4)',
              textDecoration: 'none',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Request account deletion
          </a>
        </div>
      </section>
    </div>
  );
}
