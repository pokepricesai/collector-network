import type { Metadata } from 'next';
import { getPricedTiles } from '@/server/discovery';
import CardBoard from '@/components/home/CardBoard';
import { canonicalFor } from '@/lib/seo';
import Faq from '@/components/Faq';
import { MARKET_ICONIC_FAQ } from '@/lib/faq-content';
import { getLorcanaCurrency } from '@/lib/currency-server';
import { CURRENCY_SOURCE_NAME } from '@/lib/currency';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Iconic Lorcana cards — every Iconic-tier overprint',
  description:
    "The Iconic rarity tier introduced in Set 9 (Fabled) — the rarest Lorcana overprints, priced individually.",
  alternates: { canonical: canonicalFor('/market/iconic') },
};

export default async function IconicListPage() {
  const currency = await getLorcanaCurrency();
  const tiles = await getPricedTiles({
    limit: 60,
    rarity: 'Iconic',
    cardCandidates: 40,
    currency,
  });

  return (
    <div className="lc-container lc-section">
      <header className="lc-page-hero" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">Set 9+ tier</div>
          <h1 style={{ margin: '4px 0 6px' }}>All Iconic cards</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
            Iconic is the rarest tier introduced with{' '}
            <em>Fabled</em> (Set 9) and continued through{' '}
            <em>Whispers in the Well</em>, <em>Winterspell</em>,{' '}
            <em>Wilds Unknown</em> and <em>Attack of the Vine!</em> —
            2 per set. Ranked by highest current {CURRENCY_SOURCE_NAME[currency]}
            {' '}retail ({currency}).
          </p>
        </div>
      </header>
      <CardBoard tiles={tiles} columns={5} compact emptyLabel="No Iconic cards priced yet." />
      <Faq title="About Iconic Lorcana cards" entries={MARKET_ICONIC_FAQ} />
    </div>
  );
}
