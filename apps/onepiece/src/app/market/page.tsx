import type { Metadata } from 'next';
import Link from 'next/link';
import { getMovers, type MoverEntry, type MoverWindow } from '@/server/market';
import { getCurrencyPreference } from '@/lib/onepiece/currency-server';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import { formatPrice } from '@/lib/onepiece/format-price';
import { SITE_URL } from '@/lib/site-url';
import Faq from '@/components/Faq';
import { MARKET_FAQ } from '@/lib/faq-content';

export const revalidate = 900;

const VALID_WINDOWS: MoverWindow[] = [7, 30, 90];

function parseWindow(v: string | undefined): MoverWindow {
  if (!v) return 30;
  const n = Number(v);
  return (VALID_WINDOWS as number[]).includes(n) ? (n as MoverWindow) : 30;
}

/**
 * CN-06.01-P14 — stale-data threshold per window.
 *
 * The op_market_movers_refresh RPC requires >= 3 observations per
 * printing to include it in a snapshot. For a 7-day window, 11 days
 * without a fresh refresh means the printings never accumulated the
 * minimum observations in the 7-day sliding window — a legitimate
 * insufficient-observations state, not a cron failure. We retain the
 * old cache row rather than overwrite it with empty; this threshold
 * decides when to STOP displaying that stale cache and show an
 * honest "insufficient data" state instead.
 *
 * Thresholds equal the window itself. A 7-day board cannot defensibly
 * show a snapshot older than 7 days, 30-day no older than 30, 90-day
 * no older than 90. The operator reviewed 14 days (lenient) and
 * explicitly required < 11 days for the 7-day window.
 */
const STALE_DAYS: Record<MoverWindow, number> = { 7: 7, 30: 30, 90: 90 };

function isCacheStale(computedAt: Date | null, window: MoverWindow): boolean {
  if (!computedAt) return false; // getMovers already throws on missing snapshot
  const ageMs = Date.now() - computedAt.getTime();
  const staleAfterMs = STALE_DAYS[window] * 86_400_000;
  return ageMs > staleAfterMs;
}

export const metadata: Metadata = {
  title: 'One Piece movers, 7-, 30- and 90-day price change board',
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
  const currency = await getCurrencyPreference();
  // CN-COST-03 / CN-MARKET-FIX: getMovers now reads a cache
  // snapshot via public.op_market_movers RPC. computedAt is the
  // timestamp of that snapshot — surfaced below the hero so users
  // see how fresh the movers are.
  const { risers, fallers, computedAt } = await getMovers(window, 30, currency);
  const stale = isCacheStale(computedAt, window);
  const alternateWindow: MoverWindow = window === 7 ? 30 : window === 30 ? 90 : 30;

  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
              Movers · {window}d window
            </div>
            <h1
              style={{
                margin: '4px 0 6px',
                fontSize: 'clamp(24px, 4.5vw, 30px)',
              }}
            >
              Market movers
            </h1>
            <p
              style={{
                margin: 0,
                color: 'var(--text-muted)',
                fontSize: 15,
                lineHeight: 1.55,
                maxWidth: 640,
              }}
            >
              Filtered to signal. A mover requires at least three observed days
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

            {computedAt && (
              <div
                className="label-mono"
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                }}
              >
                Data as of{' '}
                <time dateTime={computedAt.toISOString()}>
                  {computedAt.toLocaleString('en-GB', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'UTC',
                    timeZoneName: 'short',
                  })}
                </time>
              </div>
            )}
          </div>
        </header>

        {stale ? (
          <div
            role="status"
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              Insufficient recent data for the {window}-day board
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55, maxWidth: 520, margin: '0 auto 16px' }}>
              A mover requires at least three observed price days inside the {window}-day window.
              The latest {window}-day snapshot (computed{' '}
              {computedAt?.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
              ) is older than the window itself, so showing it would misrepresent the current market.
            </div>
            <Link
              href={`/market?window=${alternateWindow}`}
              className="sort-btn"
              style={{ textDecoration: 'none', display: 'inline-block' }}
            >
              View {alternateWindow}-day board instead
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))',
              gap: 20,
            }}
          >
            <Column title="Risers" tone="up" movers={risers} />
            <Column title="Fallers" tone="down" movers={fallers} />
          </div>
        )}

        <Faq title="About the One Piece market" entries={MARKET_FAQ} />
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
                      {setCode.toUpperCase() || 'SET'} · #{m.printing.collector_number ?? '–'}
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
