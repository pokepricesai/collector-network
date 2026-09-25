import type { Metadata } from 'next';
import Link from 'next/link';
import { getMovers, type MoverEntry, type MoverWindow } from '@/server/market';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { formatPrice } from '@/lib/onepiece/format-price';
import { SITE_URL } from '@/lib/site-url';

export const revalidate = 900;

const VALID_WINDOWS: MoverWindow[] = [7, 30, 90];

function parseWindow(v: string | undefined): MoverWindow {
  if (!v) return 30;
  const n = Number(v);
  return (VALID_WINDOWS as number[]).includes(n) ? (n as MoverWindow) : 30;
}

export const metadata: Metadata = {
  title: 'One Piece movers — 7-, 30- and 90-day price change board',
  description:
    'Live One Piece Card Game market movers filtered to signal. Risers and fallers by printing across 7, 30 and 90 days.',
  alternates: { canonical: `${SITE_URL}/market` },
};

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window: rawWindow } = await searchParams;
  const window = parseWindow(rawWindow);
  const { risers, fallers } = await getMovers(window, 30);

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Movers · {window}d window
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>Market movers</h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              Filtered to signal — a mover requires at least three observed days
              and a headline price of $2 or higher. Prices are always shown in
              their native currency; nothing is auto-converted.
            </p>

            <div
              style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}
            >
              {VALID_WINDOWS.map((w) => (
                <Link
                  key={w}
                  href={`/market?window=${w}`}
                  className={`sort-btn${w === window ? ' active' : ''}`}
                  style={{ textDecoration: 'none' }}
                >
                  {w} days
                </Link>
              ))}
            </div>
          </div>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 20,
          }}
        >
          <Column title="Risers" tone="up" movers={risers} />
          <Column title="Fallers" tone="down" movers={fallers} />
        </div>
      </div>
    </div>
  );
}

function Column({
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
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: tone === 'up' ? 'var(--green)' : 'var(--red)',
          }}
        >
          {tone === 'up' ? '▲' : '▼'} {movers.length}
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
          No movers in this window yet.
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
                  className="card-hover"
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
                    <span style={{ fontWeight: 700, fontSize: 14 }}>
                      {m.card.name}
                    </span>
                    <span className="label-mono">
                      {setCode.toUpperCase() || 'SET'} · #{m.printing.collector_number ?? '—'}
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
