import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

// Slim OP account dashboard. Deliberately minimal for the parity
// pass — enough to prove the auth loop and give the user a landing
// after sign-in. Richer analytics (top-value, portfolio value over
// time) come once the collection has been populated by real users.

export default async function AccountPage() {
  const user = await requireUser('/account');
  const created = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 80px' }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold-600)' }}>Account</div>
        <h1 style={{ margin: '4px 0 4px', fontFamily: 'Outfit, system-ui, sans-serif', fontSize: 28, letterSpacing: '-0.01em' }}>
          {user.email ?? 'Signed in'}
        </h1>
        {created && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Joined {created}</p>
        )}
      </header>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 14,
        }}
      >
        <Link href="/collection" style={tileStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold-600)' }}>Collect</div>
          <h2 style={tileTitleStyle}>My One Piece Collection</h2>
          <p style={tileMetaStyle}>
            Track every card you own — raw and graded — with live market value from the same data
            the rest of OnePiecePrices uses.
          </p>
        </Link>
        <Link href="/browse" style={tileStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--gold-600)' }}>Browse</div>
          <h2 style={tileTitleStyle}>Sets</h2>
          <p style={tileMetaStyle}>
            Every OP, EB and Starter Deck, sorted by release. Set value and top movers on each set page.
          </p>
        </Link>
        <form action="/auth/sign-out" method="post" style={tileStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Session</div>
          <h2 style={tileTitleStyle}>Sign out</h2>
          <p style={tileMetaStyle}>End your session on this device. Your account and collection stay put.</p>
          <button
            type="submit"
            style={{
              marginTop: 'auto',
              alignSelf: 'flex-start',
              padding: '9px 14px',
              borderRadius: 8,
              background: 'var(--surface)',
              color: 'var(--text)',
              border: '1px solid var(--border-strong, var(--border))',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Sign out
          </button>
        </form>
      </section>
    </main>
  );
}

const tileStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 18,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  textDecoration: 'none',
  color: 'var(--text)',
  minHeight: 160,
};

const tileTitleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'Outfit, system-ui, sans-serif',
  fontSize: 19,
  letterSpacing: '-0.005em',
};

const tileMetaStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.55,
  color: 'var(--text-muted)',
};
