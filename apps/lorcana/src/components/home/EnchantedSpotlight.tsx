import Link from 'next/link';
import type { DiscoveryTile } from '@/server/discovery';
import CardBoard from './CardBoard';

// Top of the collector funnel. Enchanted is the signature Lorcana
// chase rarity and this module is the fastest way to make that
// legible: dark parchment panel, gold-accented header, six tiles
// from real data. "Enchanted overprint" is the technically correct
// print-industry term (an overprint replaces a Common slot with an
// alt-art variant) but the DB records rarity=Enchanted so we lead
// with the plain rarity term.

interface Props {
  tiles: DiscoveryTile[];
  iconic?: DiscoveryTile[];
}

export default function EnchantedSpotlight({ tiles, iconic = [] }: Props) {
  if (tiles.length === 0 && iconic.length === 0) return null;

  return (
    <section className="lc-section">
      <div className="lc-container">
        <div className="lc-chase-panel">
          <header style={{ marginBottom: 20, display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            <div>
              <div className="label-mono" style={{ marginBottom: 6 }}>
                The chase axis
              </div>
              <h2 style={{ margin: 0 }}>
                Enchanted cards
              </h2>
              <p style={{ marginTop: 8, color: 'rgba(240,225,183,0.72)', maxWidth: 520, fontSize: 14, lineHeight: 1.55 }}>
                Alt-art overprints in the replaced-common slot, numbered
                past the base set. Ranked by highest current retail
                across every printing.
              </p>
            </div>
            <Link
              href="/market/enchanted"
              className="btn btn-gold btn-sm"
            >
              See all Enchanted →
            </Link>
          </header>

          <CardBoard tiles={tiles} columns={6} variant="dark" compact />

          {iconic.length > 0 && (
            <>
              <div style={{ margin: '28px 0 16px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="label-mono" style={{ color: 'var(--gold-300)' }}>
                  Iconic tier · Set 9+
                </div>
                <div style={{ flex: 1, minWidth: 40, height: 1, background: 'linear-gradient(to right, rgba(203,172,70,0.55), transparent)' }} />
                <Link
                  href="/market/iconic"
                  style={{ color: 'var(--gold-300)', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}
                >
                  See all →
                </Link>
              </div>
              <CardBoard tiles={iconic} columns={4} variant="dark" compact />
            </>
          )}
        </div>
      </div>
    </section>
  );
}
