import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';

// Settings surface. Deliberately minimal because auth is shared with
// the rest of the Collector Network — profile-level changes (password,
// email) will land network-wide, not per-app. This page currently
// gives the user a landing they can bookmark plus the "manage" hooks
// that already work (session sign-out).

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser('/settings');

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 80px' }}>
      <header style={{ marginBottom: 22 }}>
        <div className="label-mono" style={{ color: 'var(--accent-2)' }}>Settings</div>
        <h1 style={{ margin: '4px 0 4px', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 28 }}>
          Manage your account
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
          One Collector Network login covers YGO, One Piece and Lorcana.
          Changes made here apply everywhere.
        </p>
      </header>

      <div style={{ display: 'grid', gap: 16 }}>
        <section style={panel}>
          <div className="label-mono" style={{ marginBottom: 6 }}>Profile</div>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 14 }}>
            <div style={{ color: 'var(--text-muted)' }}>Email</div>
            <div style={{ color: 'var(--text-strong)' }}>{user.email ?? '—'}</div>
            <div style={{ color: 'var(--text-muted)' }}>Signed up</div>
            <div style={{ color: 'var(--text-strong)' }}>
              {user.created_at ? new Date(user.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
              }) : '—'}
            </div>
          </div>
        </section>

        <section style={panel}>
          <div className="label-mono" style={{ marginBottom: 6 }}>Collection</div>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
            Manage the cards you own. Add or edit raw and graded holdings
            with live valuation.
          </p>
          <Link href="/collection" className="btn btn-primary btn-sm">
            Open my collection →
          </Link>
        </section>

        <section style={panel}>
          <div className="label-mono" style={{ marginBottom: 6 }}>Session</div>
          <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
            End your session on this device. Your account, collection and
            preferences remain intact.
          </p>
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
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
        </section>
      </div>
    </main>
  );
}

const panel: React.CSSProperties = {
  padding: 18,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};
