// apps/onepiece/src/app/account/page.tsx
//
// Account overview. Same layout as LorcanaPrices' /account:
//   * profile card (avatar-initial + email + joined + Settings link)
//   * summary tile: Collection (holding count + open link)
//   * discover tile: Find cards CTA
//   * quick links row
//
// Editable settings live at /settings.

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, createServerSupabase } from '@collector-network/auth';
import { canonicalFor } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Account',
  description: 'Your OnePiecePrices account overview.',
  alternates: { canonical: canonicalFor('/account') },
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?returnTo=/account');

  const supabase = await createServerSupabase();
  const collectionCountRes = await supabase
    .from('op_collection_items')
    .select('*', { count: 'exact', head: true });
  const holdings = collectionCountRes.count ?? 0;

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
      })
    : null;
  const initial = (user.email ?? 'U').charAt(0).toUpperCase();
  const displayName = user.email?.split('@')[0] ?? 'Signed in';

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Account</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>Your account</h1>

      <section style={profileCardStyle}>
        <div aria-hidden style={avatarStyle}>{initial}</div>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>{displayName}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {user.email ?? 'no email on file'}
          </div>
          {joined && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>Joined {joined}</div>
          )}
        </div>
        <Link href="/settings" style={ghostBtnStyle}>Settings</Link>
      </section>

      <div style={{
        marginTop: 18,
        display: 'grid',
        gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}>
        <SummaryCard
          label="Collection"
          value={holdings.toLocaleString()}
          sub={`${holdings === 1 ? 'holding' : 'holdings'} tracked`}
          href="/collection"
          cta="Open collection"
        />
        <div style={discoverCardStyle}>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Discover</div>
          <div style={{ fontSize: 15, color: 'var(--text-strong)', fontWeight: 700 }}>
            Add cards to your collection
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every card page has an Add to collection button — pick the exact treatment and finish.
          </div>
          <div style={{ marginTop: 6 }}>
            <Link href="/card-finder" style={primaryBtnStyle}>Find cards</Link>
          </div>
        </div>
      </div>

      <section style={quickLinksStyle}>
        <div className="label-mono" style={{ marginBottom: 8, color: 'var(--gold-600)' }}>Quick links</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/settings" style={ghostBtnStyle}>Settings</Link>
          <Link href="/market" style={ghostBtnStyle}>Market</Link>
          <Link href="/leaders" style={ghostBtnStyle}>Leaders</Link>
          <Link href="/colours" style={ghostBtnStyle}>Colours</Link>
          <Link href="/insights" style={ghostBtnStyle}>Insights</Link>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, sub, href, cta }: {
  label: string; value: string; sub: string; href: string; cta: string;
}) {
  return (
    <div style={summaryCardStyle}>
      <div className="label-mono" style={{ color: 'var(--gold-600)' }}>{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, color: 'var(--text-strong)',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      <div style={{ marginTop: 4 }}>
        <Link href={href} style={primaryBtnStyle}>{cta}</Link>
      </div>
    </div>
  );
}

const profileCardStyle: React.CSSProperties = {
  marginTop: 22, padding: 22,
  background: 'linear-gradient(180deg, rgba(220,38,38,0.05) 0%, rgba(220,38,38,0) 60%), var(--surface)',
  border: '1px solid var(--border)', borderRadius: 16,
  display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
};

const avatarStyle: React.CSSProperties = {
  width: 72, height: 72, borderRadius: '50%',
  background: 'linear-gradient(135deg, #DC2626 0%, #7F1D1D 100%)',
  color: '#fff',
  fontFamily: 'Outfit, system-ui, sans-serif',
  fontSize: 30, fontWeight: 800,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
};

const summaryCardStyle: React.CSSProperties = {
  padding: 18, background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
  boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
};

const discoverCardStyle: React.CSSProperties = {
  padding: 18, background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
  boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
};

const quickLinksStyle: React.CSSProperties = {
  marginTop: 18, padding: 20,
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
};

const primaryBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px', borderRadius: 8,
  background: 'var(--gold-600)', color: '#111',
  border: '1px solid var(--gold-600)',
  fontSize: 13, fontWeight: 700,
  textDecoration: 'none',
  letterSpacing: '0.02em',
};

const ghostBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '8px 14px', borderRadius: 8,
  background: 'var(--surface)', color: 'var(--text)',
  border: '1px solid var(--border-strong, var(--border))',
  fontSize: 13, fontWeight: 600,
  textDecoration: 'none',
};
