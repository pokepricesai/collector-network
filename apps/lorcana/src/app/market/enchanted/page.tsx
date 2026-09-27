import type { Metadata } from 'next';
import { getPricedTiles } from '@/server/discovery';
import CardBoard from '@/components/home/CardBoard';
import { canonicalFor } from '@/lib/seo';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Enchanted Lorcana cards — full priced list, all sets',
  description:
    "Every Disney Lorcana Enchanted overprint ranked by cheapest current USD retail. Set 1 through Attack of the Vine!.",
  alternates: { canonical: canonicalFor('/market/enchanted') },
};

export default async function EnchantedListPage() {
  const tiles = await getPricedTiles({
    limit: 300,
    rarity: 'Enchanted',
    cardCandidates: 400,
  });

  return (
    <div className="lc-container lc-section">
      <header className="lc-page-hero" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">Chase</div>
          <h1 style={{ margin: '4px 0 6px' }}>All Enchanted cards</h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.55, maxWidth: 640 }}>
            {tiles.length > 0 ? (
              <>Showing {tiles.length} priced Enchanted cards ordered by
              cheapest current USD retail across their printings.</>
            ) : (
              <>Enchanted price data is loading. Check back shortly.</>
            )}
          </p>
        </div>
      </header>
      <CardBoard tiles={tiles} columns={6} compact emptyLabel="No Enchanted cards priced yet." />
    </div>
  );
}
