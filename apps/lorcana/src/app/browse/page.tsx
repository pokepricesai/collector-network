import type { Metadata } from 'next';
import { listCardIdsBySet, listSetsWithCounts } from '@/server/browse';
import { SITE_URL } from '@/lib/site-url';
import { getCurrentUser } from '@collector-network/auth';
import { getOwnedCardIdSetForCurrentUser } from '@/server/collection-state';
import SetsGrid, { type SetTileData } from '@/components/browse/SetsGrid';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Disney Lorcana: every set catalogued',
  description:
    'Complete Disney Lorcana set directory. Every main set, starter deck, promo pack and event product with card counts, treatment tallies and release dates.',
  alternates: { canonical: `${SITE_URL}/browse` },
};

export default async function BrowsePage() {
  const [sets, user] = await Promise.all([listSetsWithCounts(), getCurrentUser()]);
  const [owned, cardIdsBySet] = user
    ? await Promise.all([
        getOwnedCardIdSetForCurrentUser(),
        listCardIdsBySet(),
      ])
    : [new Set<string>(), {} as Record<string, string[]>];

  const entries: SetTileData[] = sets.map((s) => {
    let ownedCount = 0;
    if (user && owned.size > 0) {
      for (const id of cardIdsBySet[s.set.id] ?? []) {
        if (owned.has(id)) ownedCount++;
      }
    }
    return {
      code: s.set.code,
      name: s.set.name,
      releasedAt: s.set.released_at,
      uniqueCardCount: s.uniqueCardCount,
      variantCount: s.variantCount,
      ownedCount,
    };
  });

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
                  {!user && (
                    <>
                      {' '}
                      <a
                        href="/sign-in?returnTo=/browse"
                        style={{ color: 'var(--primary)' }}
                      >
                        Sign in to track completion
                      </a>
                      .
                    </>
                  )}
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
          <SetsGrid entries={entries} isSignedIn={Boolean(user)} />
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
