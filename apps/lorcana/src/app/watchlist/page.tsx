import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@collector-network/auth';
import { getLorcanaCurrency } from '../../lib/currency-server';
import { formatPrice } from '../../lib/currency';
import { listWatchlistForCurrentUser } from '../../server/watchlist';
import { slugifyCardName } from '../../lib/lorcana/slug';
import { canonicalFor } from '../../lib/seo';

// Signed-in watchlist. Private surface — noindex.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your Lorcana watchlist',
  robots: { index: false, follow: false },
  alternates: { canonical: canonicalFor('/watchlist') },
};

export default async function WatchlistPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?returnTo=/watchlist');
  const currency = await getLorcanaCurrency();
  const result = await listWatchlistForCurrentUser(currency);

  return (
    <div className="lc-container lc-section">
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Your watchlist</h1>
        <p style={{ color: 'var(--text-muted)', marginTop: 6 }}>
          Cards you&rsquo;re tracking. Prices in {currency} from{' '}
          {currency === 'USD' ? 'TCGPlayer' : 'Cardmarket'}.
        </p>
      </header>

      {result.ok === false ? (
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          Watchlist is temporarily unavailable — retry in a moment.
        </div>
      ) : result.value.items.length === 0 ? (
        <div
          style={{
            padding: 24,
            borderRadius: 12,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
          }}
        >
          <p style={{ margin: 0 }}>
            You&rsquo;re not watching any cards yet. Open a card and press{' '}
            <strong>Watch</strong> to track it here.
          </p>
          <p style={{ marginTop: 12 }}>
            <Link href="/card-finder">Find cards →</Link>
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 16,
          }}
        >
          {result.value.items.map((item) => {
            const cardSlug = slugifyCardName(item.card?.name ?? '');
            const price = item.priceInCurrency;
            return (
              <Link
                key={item.row.id}
                href={`/card/${cardSlug}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  textDecoration: 'none',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {item.card?.name ?? '(missing card)'}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {item.set?.code?.toUpperCase() ?? ''} {item.card?.collector_number ?? ''}
                  {item.card?.rarity ? ` · ${item.card.rarity}` : ''}
                </div>
                <div style={{ marginTop: 10, fontSize: 14, fontWeight: 700 }}>
                  {formatPrice(price, currency)}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
