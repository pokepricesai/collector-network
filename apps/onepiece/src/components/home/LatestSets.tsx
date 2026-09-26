import Link from 'next/link';
import type { OpSetSummary } from '@/server/browse';

export default function LatestSets({ sets }: { sets: OpSetSummary[] }) {
  return (
    <section style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Latest sets
            </div>
            <h2 style={{ fontSize: 28, margin: '4px 0 0' }}>Newest releases</h2>
          </div>
          <Link href="/browse" className="btn btn-ghost btn-sm">
            All sets
          </Link>
        </div>

        {sets.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
              gap: 14,
            }}
          >
            {sets.map((s) => (
              <Link
                key={s.set.id}
                href={`/set/${encodeURIComponent(s.set.code)}`}
                className="card-hover card-hover-gold"
                style={{
                  display: 'block',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: 16,
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <div className="label-mono" style={{ color: 'var(--text-muted)' }}>
                  {s.set.code.toUpperCase()}
                </div>
                <div
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 700,
                    fontSize: 15.5,
                    color: 'var(--text-strong)',
                    marginTop: 4,
                    lineHeight: 1.2,
                    minHeight: 40,
                  }}
                >
                  {s.set.name}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 10,
                    fontSize: 12.5,
                    color: 'var(--text-muted)',
                  }}
                >
                  <span>{formatReleased(s.set.released_at)}</span>
                  <span>
                    {s.uniqueCardCount} card{s.uniqueCardCount === 1 ? '' : 's'}
                    {s.variantCount > s.uniqueCardCount && (
                      <span
                        style={{
                          color: 'var(--gold-600)',
                          marginLeft: 6,
                          fontWeight: 600,
                        }}
                        title="Treatments (parallel / alt-art / manga rare / etc.)"
                      >
                        +{s.variantCount - s.uniqueCardCount} treatments
                      </span>
                    )}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '28px',
        background: 'var(--surface)',
        border: '1px dashed var(--border-strong)',
        borderRadius: 14,
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      Sets appear here as soon as the catalogue is ready.
    </div>
  );
}

function formatReleased(iso: string | null): string {
  if (!iso) return 'Release TBA';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}
