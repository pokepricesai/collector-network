import type { Metadata } from 'next';
import Link from 'next/link';
import { getPricedTiles } from '@/server/discovery';
import CardBoard from '@/components/home/CardBoard';
import { SITE_URL } from '@/lib/site-url';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Lorcana market — most valuable cards, Enchanted chase, Iconic overprints',
  description:
    'Live Disney Lorcana market at a glance. Most valuable cards, Enchanted overprints and Iconic-tier chase, priced individually by cheapest current retail.',
  alternates: { canonical: `${SITE_URL}/market` },
};

// /market: value-first board, no movers. The daily-retail window is
// only 6 days (see docs/lorcana/data-audit.md §D) so a "biggest
// mover" panel would be dishonest. We surface honest value-ordered
// modules instead and disclose the missing history explicitly.

export default async function MarketPage() {
  const [mostValuable, enchanted, iconic, legendary] = await Promise.all([
    getPricedTiles({ limit: 18, cardCandidates: 500 }),
    getPricedTiles({ limit: 12, rarity: 'Enchanted', cardCandidates: 240 }),
    getPricedTiles({ limit: 8, rarity: 'Iconic', cardCandidates: 30 }),
    getPricedTiles({ limit: 8, rarity: 'Legendary', cardCandidates: 200 }),
  ]);

  return (
    <div className="lc-container lc-section">
      <header className="lc-page-hero" style={{ marginBottom: 28 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">Market</div>
          <h1 style={{ margin: '4px 0 6px' }}>
            Lorcana at a glance
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
            Value-ranked, priced individually. Cardmarket EUR and TCGplayer
            USD refreshed daily. Every card links through to its full
            treatment map.
          </p>
        </div>
      </header>

      <section id="most-valuable" style={{ marginBottom: 36 }}>
        <header style={{ marginBottom: 14, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div className="label-mono">Section</div>
            <h2 style={{ margin: '4px 0 0' }}>Most valuable cards</h2>
          </div>
        </header>
        <CardBoard tiles={mostValuable} columns={6} compact />
      </section>

      <section id="enchanted" style={{ marginBottom: 36 }}>
        <div className="lc-chase-panel">
          <header style={{ marginBottom: 14, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div className="label-mono">Chase</div>
              <h2 style={{ margin: '4px 0 0' }}>Enchanted overprints</h2>
            </div>
            <Link href="/market/enchanted" className="btn btn-gold btn-sm">See all Enchanted →</Link>
          </header>
          <CardBoard tiles={enchanted} columns={6} variant="dark" compact />
        </div>
      </section>

      {iconic.length > 0 && (
        <section id="iconic" style={{ marginBottom: 36 }}>
          <header style={{ marginBottom: 14, display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <div className="label-mono">Set 9+</div>
              <h2 style={{ margin: '4px 0 0' }}>Iconic overprints</h2>
            </div>
            <Link href="/market/iconic" className="btn btn-ghost btn-sm">See all Iconic →</Link>
          </header>
          <CardBoard tiles={iconic} columns={4} compact />
        </section>
      )}

      {legendary.length > 0 && (
        <section id="legendary" style={{ marginBottom: 36 }}>
          <header style={{ marginBottom: 14 }}>
            <div className="label-mono">Rarity tier</div>
            <h2 style={{ margin: '4px 0 0' }}>Top Legendary cards</h2>
          </header>
          <CardBoard tiles={legendary} columns={4} compact />
        </section>
      )}

      <section style={{ marginBottom: 24 }}>
        <div className="lc-panel" style={{
          borderStyle: 'dashed',
          borderColor: 'var(--border-strong)',
          background: 'transparent',
        }}>
          <div className="label-mono" style={{ marginBottom: 6 }}>Coming soon</div>
          <h3 style={{ margin: '0 0 6px' }}>7- and 30-day price movers</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
            Daily retail history has been ingesting since 21 Sep 2026. The
            movers board unlocks once the observed window crosses 30 days,
            so a rise-vs-fall comparison is honest rather than a two-day
            snapshot. Set-value change tracking follows on the same
            timeline.
          </p>
        </div>
      </section>
    </div>
  );
}
