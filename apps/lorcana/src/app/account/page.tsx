// apps/lorcana/src/app/account/page.tsx
//
// Account overview. Modelled on MTGPrices' /account layout:
//   * profile card (avatar-ish initial + email + joined)
//   * summary card: Collection (row count + open link)
//   * quick links section
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
  description: 'Your LorcanaPrices account overview.',
  alternates: { canonical: canonicalFor('/account') },
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/account');

  const supabase = await createServerSupabase();
  const collectionCountRes = await supabase
    .from('lorcana_collection_items')
    .select('*', { count: 'exact', head: true });
  const holdings = collectionCountRes.count ?? 0;

  const joined = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })
    : null;
  const initial = (user.email ?? 'U').charAt(0).toUpperCase();
  const displayName = user.email?.split('@')[0] ?? 'Signed in';

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px 80px' }}>
      <div className="label-mono">Account</div>
      <h1 style={{ margin: '6px 0 0', fontSize: 28, color: 'var(--text-strong)' }}>
        Your account
      </h1>

      <section style={{
        marginTop: 22, padding: 22,
        background: 'linear-gradient(180deg, rgba(106,67,190,0.06) 0%, rgba(106,67,190,0) 60%), var(--surface)',
        border: '1px solid var(--border)', borderRadius: 16,
        display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
      }}>
        <div
          aria-hidden
          style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'var(--ink-amethyst, #6A43BE)',
            color: '#fff',
            fontFamily: 'Outfit, system-ui, sans-serif',
            fontSize: 30, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-strong)' }}>
            {displayName}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            {user.email ?? 'no email on file'}
          </div>
          {joined && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Joined {joined}
            </div>
          )}
        </div>
        <Link href="/settings" className="btn btn-sm btn-ghost">Settings</Link>
      </section>

      <div style={{
        marginTop: 18, display: 'grid', gap: 14,
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
      }}>
        <SummaryCard
          label="Collection"
          value={holdings.toLocaleString()}
          sub={`${holdings === 1 ? 'holding' : 'holdings'} tracked`}
          href="/collection"
          cta="Open collection"
        />
        <div style={{
          padding: 18, background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
          boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
        }}>
          <div className="label-mono">Discover</div>
          <div style={{ fontSize: 15, color: 'var(--text-strong)', fontWeight: 700 }}>
            Add cards to your collection
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Every card page has an Add to collection button. Save exact
            printings, foil vs nonfoil, quantity and condition.
          </div>
          <div style={{ marginTop: 6 }}>
            <Link href="/card-finder" className="btn btn-sm btn-primary">Find cards</Link>
          </div>
        </div>
      </div>

      <section style={{
        marginTop: 18, padding: 20,
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
      }}>
        <div className="label-mono" style={{ marginBottom: 8 }}>Quick links</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/settings" className="btn btn-sm btn-ghost">Settings</Link>
          <Link href="/market" className="btn btn-sm btn-ghost">Market</Link>
          <Link href="/market/enchanted" className="btn btn-sm btn-ghost">Enchanted</Link>
          <Link href="/insights" className="btn btn-sm btn-ghost">Insights</Link>
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ label, value, sub, href, cta }: {
  label: string;
  value: string;
  sub: string;
  href: string;
  cta: string;
}) {
  return (
    <div style={{
      padding: 18, background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 8,
      boxShadow: '0 4px 14px rgba(20,33,61,0.04)',
    }}>
      <div className="label-mono">{label}</div>
      <div style={{
        fontSize: 28, fontWeight: 800, color: 'var(--text-strong)',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sub}</div>
      <div style={{ marginTop: 4 }}>
        <Link href={href} className="btn btn-sm btn-primary">{cta}</Link>
      </div>
    </div>
  );
}
