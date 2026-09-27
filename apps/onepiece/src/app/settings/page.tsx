// apps/onepiece/src/app/settings/page.tsx
//
// Editable user settings. Three vertical sections:
//   Account     email + sign-out
//   Password    reset-password link
//   Danger zone delete-account (soft — mailto so support can confirm
//               the shared-identity impact before the deletion runs)
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
  description: 'OnePiecePrices account settings.',
  alternates: { canonical: canonicalFor('/settings') },
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?returnTo=/settings');

  return (
    <div style={{ maxWidth: 780, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Settings</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>Settings</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 6, lineHeight: 1.55 }}>
        Manage your OnePiecePrices account and identity. One Collector
        Network login covers Yu-Gi-Oh, One Piece and Lorcana — changes
        apply everywhere.
      </p>

      <section id="account" style={sectionStyle}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Account</div>
        <h2 style={h2Style}>Sign in and identity</h2>
        <p style={pStyle}>
          Your sign-in identity is shared with the wider Collector Network.
          Changing your email or password here applies everywhere.
        </p>
        <div style={{
          marginTop: 12, padding: 12,
          background: 'var(--bg-light)', border: '1px solid var(--border)',
          borderRadius: 10, fontSize: 13,
        }}>
          <div><strong>Email</strong> {user.email ?? 'no email on file'}</div>
          {user.created_at && (
            <div style={{ marginTop: 4 }}>
              <strong>Joined</strong>{' '}
              {new Date(user.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              style={{
                padding: '9px 14px', borderRadius: 8,
                background: 'var(--surface)', color: 'var(--text)',
                border: '1px solid var(--border-strong, var(--border))',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 13, fontWeight: 700,
              }}
            >Sign out</button>
          </form>
        </div>
      </section>

      <section id="password" style={sectionStyle}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Password</div>
        <h2 style={h2Style}>Change password</h2>
        <p style={pStyle}>
          Password reset is delivered by email through the shared Collector
          Network auth pipeline.
        </p>
        <div style={{ marginTop: 12 }}>
          <Link href="/account/reset-password" style={primaryBtnStyle}>Reset password</Link>
        </div>
      </section>

      <section id="danger" style={{ ...sectionStyle, borderColor: 'rgba(193,56,73,0.35)' }}>
        <div className="label-mono" style={{ marginBottom: 8, color: '#C13849' }}>Danger zone</div>
        <h2 style={h2Style}>Delete account</h2>
        <p style={pStyle}>
          Deletes your OnePiecePrices collection holdings and revokes this
          account&apos;s access to the shared Collector Network. If your
          identity is shared with other sites you will lose access there
          too. This action cannot be undone.
        </p>
        <p style={pStyle}>
          Delete-account is currently handled by contacting support so we
          can confirm the shared-identity impact before the deletion runs.
        </p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={`mailto:hello@onepieceprices.io?subject=${encodeURIComponent('Delete my OnePiecePrices account')}&body=${encodeURIComponent(`Please delete the account associated with ${user.email ?? 'my email'}.`)}`}
            style={{
              padding: '9px 14px', borderRadius: 8,
              background: 'transparent',
              color: '#C13849',
              border: '1px solid rgba(193,56,73,0.4)',
              textDecoration: 'none',
              fontSize: 13, fontWeight: 700,
            }}
          >
            Request account deletion
          </a>
        </div>
      </section>
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  marginTop: 22, padding: 22,
  background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: 14,
};

const h2Style: React.CSSProperties = {
  margin: 0, fontSize: 20, color: 'var(--text-strong)',
};

const pStyle: React.CSSProperties = {
  color: 'var(--text-muted)', fontSize: 13, marginTop: 6, lineHeight: 1.55,
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '9px 14px', borderRadius: 8,
  background: 'var(--gold-600)', color: '#111',
  border: '1px solid var(--gold-600)',
  fontSize: 13, fontWeight: 700, textDecoration: 'none',
  letterSpacing: '0.02em',
};
