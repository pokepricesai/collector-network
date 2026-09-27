import type { HistoryBundle, HistorySeries } from '@/server/history';
import { formatPrice } from '@/lib/onepiece/format-price';

// Compact per-series sparkline. Renders one line per (source, currency,
// finish) so the collector reads the trend in their preferred currency
// without merging conflicting series.
//
// Degradation: if a series has < 2 points, we render the single point as
// a dot + headline value. If the bundle is empty, we render nothing.

const HEIGHT = 44;
const WIDTH = 200;
const PAD = 4;

export default function PriceHistorySpark({ history }: { history: HistoryBundle }) {
  if (history.series.length === 0) return null;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span className="label-mono" style={{ color: 'var(--gold-600)' }}>
          Price history
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {history.observedFrom} → {history.observedTo}
        </span>
      </div>
      {history.series.map((s, i) => (
        <SeriesRow key={i} series={s} />
      ))}
    </div>
  );
}

function SeriesRow({ series }: { series: HistorySeries }) {
  const pts = series.points;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const change = pts.length > 1 && first.price > 0 ? (last.price - first.price) / first.price : 0;
  const changeLabel =
    pts.length > 1
      ? `${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`
      : 'single day';
  const changeColor =
    pts.length > 1
      ? change >= 0
        ? 'var(--green)'
        : 'var(--red)'
      : 'var(--text-muted)';
  const values = pts.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const denom = max - min || 1;

  const points = pts
    .map((p, idx) => {
      const x = pts.length === 1 ? WIDTH / 2 : PAD + (idx * (WIDTH - PAD * 2)) / (pts.length - 1);
      const y = HEIGHT - PAD - ((p.price - min) / denom) * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 10px',
        background: 'var(--bg-light)',
        border: '1px solid var(--border)',
        borderRadius: 10,
      }}
    >
      <div style={{ minWidth: 0, flex: 1, display: 'grid', gap: 2 }}>
        <span
          className="label-mono"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {series.source} · {series.currency}
          {series.finish ? ` · ${series.finish}` : ''}
        </span>
        <span style={{ fontWeight: 700 }}>
          {formatPrice(last.price, series.currency)}
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: changeColor }}>
          {changeLabel} · {pts.length} day{pts.length === 1 ? '' : 's'}
        </span>
      </div>
      <svg
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={`${series.source} ${series.currency} price history`}
      >
        {pts.length === 1 ? (
          <circle
            cx={WIDTH / 2}
            cy={HEIGHT / 2}
            r={3}
            fill={changeColor}
          />
        ) : (
          <>
            <polyline
              fill="none"
              stroke={changeColor}
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
            {/* Endpoints */}
            <circle
              cx={PAD}
              cy={HEIGHT - PAD - ((first.price - min) / denom) * (HEIGHT - PAD * 2)}
              r={2.2}
              fill={changeColor}
            />
            <circle
              cx={WIDTH - PAD}
              cy={HEIGHT - PAD - ((last.price - min) / denom) * (HEIGHT - PAD * 2)}
              r={2.2}
              fill={changeColor}
            />
          </>
        )}
      </svg>
    </div>
  );
}
