import type { Metadata } from 'next';
import { listSetsWithCounts } from '@/server/browse';
import { SITE_URL } from '@/lib/site-url';
import { BrowseGridClient } from '@/components/browse/BrowseGridClient';
import { SignInToTrackPrompt } from '@/components/browse/SignInToTrackPrompt';
import type { SetTileData } from '@/components/browse/SetsGrid';

// CN-COST-06: ISR'd. Per-user ownership (ownedCount) is lifted out
// of the server tree into BrowseGridClient, which resolves the
// supabase session on mount and fetches /api/collection/counts-by-set
// when signed in. The cached HTML carries only globally-cacheable
// catalogue facts; ownership data never enters the ISR cache.
//
// Revalidate matches the inner listSetsWithCounts cache
// (unstable_cache revalidate: 3600). Next clamps the page's ISR
// cadence to the shortest cache in the tree, so declaring the same
// value here keeps the exported config honest.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Disney Lorcana: every set catalogued',
  description:
    'Complete Disney Lorcana set directory. Every main set, starter deck, promo pack and event product with card counts, treatment tallies and release dates.',
  alternates: { canonical: `${SITE_URL}/browse` },
};

export default async function BrowsePage() {
  const sets = await listSetsWithCounts();

  // Server-rendered entries have ownedCount = 0 for every set.
  // BrowseGridClient merges the real per-user counts in client-side
  // after the supabase session resolves. The cached ISR HTML never
  // carries user-specific data.
  const entries: SetTileData[] = sets.map((s) => ({
    code: s.set.code,
    name: s.set.name,
    releasedAt: s.set.released_at,
    uniqueCardCount: s.uniqueCardCount,
    variantCount: s.variantCount,
    ownedCount: 0,
  }));

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="lc-page-hero" style={{ marginBottom: 16 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--accent-2)' }}>Sets</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 'clamp(24px, 4.5vw, 30px)' }}>
              Every Lorcana set
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                maxWidth: 640,
                lineHeight: 1.55,
              }}
            >
              {sets.length > 0 ? (
                <>
                  {sets.length} set{sets.length === 1 ? '' : 's'}. Card and treatment
                  counts include Enchanted, Iconic, Epic, Legendary and Promo
                  overprints across foil and nonfoil.
                  <SignInToTrackPrompt />
                </>
              ) : (
                <>Sets are on their way, every main product, starter deck and promo pack.</>
              )}
            </p>
          </div>
        </header>

        {sets.length === 0 ? (
          <EmptyState />
        ) : (
          <BrowseGridClient entries={entries} />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '48px 24px',
        background: 'var(--surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 16,
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      Sets are on their way. When they arrive, every main product, starter
      deck and promo will appear here.
    </div>
  );
}
