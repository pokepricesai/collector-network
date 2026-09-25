import type { Metadata } from 'next';
import Link from 'next/link';
import { listSetsWithCounts } from '@/server/browse';
import { SITE_URL } from '@/lib/site-url';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'One Piece Card Game — every set catalogued',
  description:
    'Complete One Piece Card Game set directory. Every main set, starter deck, promo pack and event product with card counts, treatment tallies and release dates.',
  alternates: { canonical: `${SITE_URL}/browse` },
};

export default async function BrowsePage() {
  const sets = await listSetsWithCounts();

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Sets
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Every One Piece set
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
              {sets.length > 0
                ? `${sets.length} set${sets.length === 1 ? '' : 's'} in the catalogue.`
                : 'Set catalogue arrives with the ingest pipeline.'}
              {' '}Ordered by release date. Treatment counts include parallels,
              alternate arts, manga rares and secret rares.
            </p>
          </div>
        </header>

        {sets.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 14,
            }}
          >
            {sets.map((s) => (
              <Link
                key={s.set.id}
                href={`/set/${encodeURIComponent(s.set.code.toLowerCase())}`}
                className="card-hover card-hover-gold"
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: 16,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="label-mono" style={{ color: 'var(--text-muted)' }}>
                    {s.set.code.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatReleased(s.set.released_at)}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text-strong)',
                    lineHeight: 1.25,
                  }}
                >
                  {s.set.name}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <span>
                    {s.uniqueCardCount} card{s.uniqueCardCount === 1 ? '' : 's'}
                  </span>
                  {s.variantCount > s.uniqueCardCount && (
                    <span
                      style={{
                        color: 'var(--gold-600)',
                        marginLeft: 8,
                        fontWeight: 600,
                      }}
                    >
                      · +{s.variantCount - s.uniqueCardCount} treatments
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
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
      No sets in the catalogue yet. When ingest lands, every main product,
      starter deck and promo will appear here.
    </div>
  );
}

function formatReleased(iso: string | null): string {
  if (!iso) return 'TBA';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
  } catch {
    return iso;
  }
}
