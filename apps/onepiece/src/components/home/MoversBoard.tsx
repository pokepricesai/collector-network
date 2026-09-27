import Link from 'next/link';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { formatPrice } from '@/lib/onepiece/format-price';
import type { MoverEntry } from '@/server/market';

export default function MoversBoard({
  risers,
  fallers,
}: {
  risers: MoverEntry[];
  fallers: MoverEntry[];
}) {
  return (
    <section className="feature-shell" style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Market pulse · 30d
            </div>
            <h2 style={{ fontSize: 28, margin: '4px 0 0' }}>
              Movers on the horizon
            </h2>
          </div>
          <Link href="/market" className="btn btn-ghost btn-sm">
            Full board
          </Link>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))',
            gap: 20,
          }}
        >
          <MoverColumn title="Risers" tone="up" movers={risers} />
          <MoverColumn title="Fallers" tone="down" movers={fallers} />
        </div>
      </div>
    </section>
  );
}

function MoverColumn({
  title,
  tone,
  movers,
}: {
  title: string;
  tone: 'up' | 'down';
  movers: MoverEntry[];
}) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 17 }}>{title}</h3>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: tone === 'up' ? 'var(--green)' : 'var(--red)',
          }}
        >
          {tone === 'up' ? '▲ 30 days' : '▼ 30 days'}
        </span>
      </div>
      {movers.length === 0 ? (
        <div
          style={{
            padding: '18px 4px',
            fontSize: 13,
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          No movers yet — price history arrives with the ingest cadence.
        </div>
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
          {movers.map((m) => {
            const slug = buildPrintingSlug(m.printing.collector_number, m.card.name);
            const setCode = m.set?.code ?? '';
            const href = `/set/${encodeURIComponent(setCode.toLowerCase())}/card/${encodeURIComponent(slug)}`;
            return (
              <li key={m.printing.id}>
                <Link
                  href={href}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 10,
                    textDecoration: 'none',
                    color: 'var(--text)',
                    background: 'var(--bg-light)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <span style={{ display: 'grid', gap: 2 }}>
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{m.card.name}</span>
                    <span className="label-mono">
                      {setCode.toUpperCase() || 'SET'} · {m.printing.collector_number ?? '—'}
                    </span>
                  </span>
                  <span style={{ display: 'grid', gap: 2, textAlign: 'right' }}>
                    <span style={{ fontWeight: 700 }}>
                      {formatPrice(m.latestPrice, m.currency)}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: tone === 'up' ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {tone === 'up' ? '+' : ''}
                      {(m.changePct * 100).toFixed(1)}%
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
