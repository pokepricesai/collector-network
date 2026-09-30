import Link from 'next/link';
import type { DiscoveryTile } from '@/server/discovery';
import CardBoard from './CardBoard';
import { CURRENCY_SOURCE_NAME, DEFAULT_CURRENCY, type LorcanaCurrency } from '@/lib/currency';

// "Most valuable Lorcana cards" — the network-wide top-value board.
// Anchors browse activity for collectors landing cold on the homepage.

export default function MostValuable({
  tiles,
  currency = DEFAULT_CURRENCY,
}: {
  tiles: DiscoveryTile[];
  currency?: LorcanaCurrency;
}) {
  if (tiles.length === 0) return null;
  return (
    <section className="lc-section">
      <div className="lc-container">
        <header style={{
          marginBottom: 18,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}>
          <div>
            <div className="label-mono">Most valuable</div>
            <h2 style={{ margin: '4px 0 0' }}>Top-priced Lorcana cards</h2>
          </div>
          <Link href="/market" className="btn btn-ghost btn-sm">Full market →</Link>
        </header>
        <CardBoard tiles={tiles} columns={6} compact />
        <p style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--text-muted)',
          maxWidth: 620,
        }}>
          Ranked by highest current {currency} retail on {CURRENCY_SOURCE_NAME[currency]}
          {' '}across every printing of the card. Toggle currency in the header
          to swap the ranking market.
        </p>
      </div>
    </section>
  );
}
