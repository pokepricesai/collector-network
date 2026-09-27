import Link from 'next/link';
import type { LcSetSummary } from '@/server/browse';

// Set index tile band on the homepage. Shows the 6 newest releases
// with release date, unique card count and treatment tally so a
// visitor can dive into a specific set without hitting /browse first.

interface Props {
  sets: LcSetSummary[];
}

export default function LatestSets({ sets }: Props) {
  if (sets.length === 0) return null;

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
            <div className="label-mono">Latest releases</div>
            <h2 style={{ margin: '4px 0 0' }}>Newest Lorcana sets</h2>
          </div>
          <Link href="/browse" className="btn btn-ghost btn-sm">All sets →</Link>
        </header>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
          gap: 12,
        }}>
          {sets.map((s) => (
            <Link
              key={s.set.id}
              href={`/set/${encodeURIComponent(s.set.code.toLowerCase())}`}
              className="lc-hover lc-hover-gold"
              style={{
                display: 'grid',
                gap: 10,
                padding: 16,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span className="label-mono" style={{ color: 'var(--text-muted)' }}>
                  {s.set.code.toUpperCase()}
                </span>
                {s.set.released_at && (
                  <span className="label-mono" style={{ color: 'var(--text-subtle)' }}>
                    {formatDate(s.set.released_at)}
                  </span>
                )}
              </div>
              <div style={{
                fontWeight: 800,
                fontSize: 17,
                fontFamily: 'Outfit, sans-serif',
                color: 'var(--text-strong)',
                lineHeight: 1.2,
              }}>
                {s.set.name}
              </div>
              <div style={{
                display: 'flex', gap: 6, flexWrap: 'wrap',
                marginTop: 2, fontSize: 12.5, color: 'var(--text-muted)',
              }}>
                <span>
                  <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{s.uniqueCardCount}</strong> cards
                </span>
                <span aria-hidden style={{ opacity: 0.5 }}>·</span>
                <span>
                  <strong style={{ color: 'var(--text-strong)', fontFamily: 'ui-monospace, monospace' }}>{s.variantCount}</strong> printings
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                Open set →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch { return iso; }
}
