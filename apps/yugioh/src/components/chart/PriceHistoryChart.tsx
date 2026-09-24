'use client';

// Minimal SVG line chart for YGO Slice A. No external chart lib:
// keeps the bundle small, gives us full control over the crimson/
// gold/purple brand palette, and renders perfectly during SSR. The
// component is client-only because of the hover crosshair state and
// range/series pickers.
//
// Input contract: caller passes already-composed series. This
// component does no fetching and knows nothing about the DB.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TIME_RANGES,
  availableRanges,
  clipSeries,
  percentChange,
  type PricePoint,
  type TimeRange,
} from '../../server/history';
import styles from './PriceHistoryChart.module.css';

export interface ChartSeries {
  key: string;
  label: string;
  currency: string;
  points: PricePoint[];
  // Optional stable colour override; when absent we cycle the palette
  // deterministically by series index.
  colour?: string;
}

interface Props {
  title: string;
  series: ChartSeries[];
  // Days of coverage — drives which range chips are visible.
  daysCovered: number;
  // Optional context line shown above the plot ("PSA 10 · card-scoped
  // attribution" etc.).
  subtitle?: string;
  // If true, users can toggle individual series on/off. When false the
  // whole series set renders unconditionally (used when the caller has
  // already picked a small set).
  seriesTogglable?: boolean;
  // Default selected series keys. If not provided, we show up to two
  // series by default — priority: raw first, then the first non-raw.
  defaultSelectedKeys?: readonly string[];
  // Optional line under the footer ("Snapshot history depth …").
  footerNote?: string;
}

// Brand palette. Chosen to survive overlapping traces without turning
// into a rainbow of neon; gold + crimson stay stable across the deck.
const PALETTE: readonly string[] = [
  '#e8c069', // gold-strong
  '#e14e50', // crimson-strong
  '#9668d0', // royal-strong
  '#e57a1c', // ember
  '#6ec06e', // green (up)
  '#7fa3ff', // focus blue
  '#c47a1c', // limited amber
  '#b7a3d2', // secret lilac
];

interface HoverState {
  seriesIndex: number;
  pointIndex: number;
  x: number;
  y: number;
}

export function PriceHistoryChart({
  title,
  series: allSeries,
  daysCovered,
  subtitle,
  seriesTogglable = true,
  defaultSelectedKeys,
  footerNote,
}: Props) {
  // ── Default series selection ───────────────────────────────────
  const initialKeys = useMemo(() => {
    if (defaultSelectedKeys && defaultSelectedKeys.length > 0) {
      return new Set(defaultSelectedKeys.filter((k) =>
        allSeries.some((s) => s.key === k),
      ));
    }
    // Sensible fallback: raw first (if any grader-key hints "raw"), then
    // the topmost remaining series. Capped at 2 by default so vintage
    // pages with 9 grades don't render an unreadable smear.
    const chosen: string[] = [];
    const raw = allSeries.find((s) => /^raw/i.test(s.key));
    if (raw) chosen.push(raw.key);
    for (const s of allSeries) {
      if (chosen.length >= 2) break;
      if (!chosen.includes(s.key)) chosen.push(s.key);
    }
    return new Set(chosen);
  }, [allSeries, defaultSelectedKeys]);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(initialKeys);
  const [range, setRange] = useState<TimeRange>(() => {
    // Prefer the widest sensible range for young datasets.
    const ranges = availableRanges([allSeries], daysCovered);
    return ranges.at(-1) ?? TIME_RANGES[TIME_RANGES.length - 1]!;
  });

  // Recompute when props change (e.g., page-scoped rerender). Reset
  // selectedKeys on set change so switching cards doesn't leak state.
  useEffect(() => {
    setSelectedKeys(initialKeys);
  }, [initialKeys]);

  const activeSeries = useMemo(
    () =>
      allSeries
        .filter((s) => selectedKeys.has(s.key) && s.points.length > 0)
        .map((s, i) => ({ ...s, colour: s.colour ?? PALETTE[i % PALETTE.length]! })),
    [allSeries, selectedKeys],
  );

  const clipped = useMemo(
    () => clipSeries(activeSeries, range.days),
    [activeSeries, range.days],
  );

  const anyPoints = clipped.some((s) => s.points.length > 0);

  const ranges = useMemo(
    () => availableRanges([allSeries], daysCovered),
    [allSeries, daysCovered],
  );

  const currency = clipped[0]?.currency ?? 'USD';

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <p className={styles.title}>{title}</p>
          {subtitle && <p className={styles.coverage}>{subtitle}</p>}
        </div>
        <span className={styles.coverage}>
          {daysCovered > 0
            ? `Snapshot depth: ${daysCovered} distinct day${daysCovered === 1 ? '' : 's'}`
            : 'No history yet'}
        </span>
      </div>

      <div className={styles.controls}>
        {ranges.length > 1 && (
          <div className={styles.rangeGroup} role="group" aria-label="Time range">
            {ranges.map((r) => {
              const active = r.key === range.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                  onClick={() => setRange(r)}
                  aria-pressed={active}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        )}
        {seriesTogglable && allSeries.length > 1 && (
          <>
            <span className={styles.seriesLabel}>Series</span>
            <div className={styles.seriesGroup} role="group" aria-label="Series">
              {allSeries.map((s, i) => {
                const active = selectedKeys.has(s.key);
                const colour = s.colour ?? PALETTE[i % PALETTE.length]!;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`${styles.chip} ${active ? styles.chipActive : ''}`}
                    onClick={() => {
                      setSelectedKeys((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.key)) next.delete(s.key);
                        else next.add(s.key);
                        return next;
                      });
                    }}
                    aria-pressed={active}
                    style={active ? undefined : { borderLeft: `3px solid ${colour}` }}
                    title={s.label}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {anyPoints ? (
        <Plot series={clipped} currency={currency} />
      ) : (
        <div className={styles.empty}>
          No observations in this range yet. The daily snapshot pipeline
          began accumulating recently for this card; try &ldquo;All&rdquo;
          to see the full available window.
        </div>
      )}

      {anyPoints && (
        <div className={styles.footer}>
          <div className={styles.legend}>
            {clipped.map((s) => {
              const last = s.points.at(-1);
              const change = percentChange(s.points);
              return (
                <span key={s.key} className={styles.legendItem}>
                  <span className={styles.swatch} style={{ background: s.colour }} />
                  <span>{s.label}</span>
                  {last && (
                    <>
                      <span className={styles.legendPrice}>
                        {formatCurrency(last.price, s.currency)}
                      </span>
                      {change != null && (
                        <span
                          className={`${styles.legendChange} ${
                            change >= 0 ? styles.up : styles.down
                          }`}
                        >
                          {change >= 0 ? '+' : ''}
                          {change.toFixed(1)}%
                        </span>
                      )}
                    </>
                  )}
                </span>
              );
            })}
          </div>
          {footerNote && <span>{footerNote}</span>}
        </div>
      )}
    </div>
  );
}

// ── SVG plot ─────────────────────────────────────────────────────

interface PlotSeries extends ChartSeries {
  colour: string;
}

function Plot({ series, currency }: { series: PlotSeries[]; currency: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<HoverState | null>(null);

  // Track container width for responsive rendering. viewBox scales
  // uniformly; we set explicit pixel widths on the SVG to keep the
  // axis text crisp.
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(320, Math.floor(w)));
    });
    obs.observe(el);
    setWidth(Math.max(320, Math.floor(el.getBoundingClientRect().width)));
    return () => obs.disconnect();
  }, []);

  const height = width < 480 ? 200 : 260;
  const M = { top: 14, right: 14, bottom: 24, left: 48 };
  const innerW = width - M.left - M.right;
  const innerH = height - M.top - M.bottom;

  // Collect all points to compute domain.
  const allPoints = useMemo(
    () => series.flatMap((s) => s.points),
    [series],
  );
  const domain = useMemo(() => {
    if (allPoints.length === 0)
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    const xs = allPoints.map((p) => Date.parse(p.date + 'T00:00:00Z'));
    const ys = allPoints.map((p) => p.price);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    // Pad y by 8% so lines never hug the top/bottom edges. If all
    // points are the same value (thin dataset), give a small band so
    // the line is visible.
    const yPad = yMax === yMin ? Math.max(yMax * 0.05, 0.5) : (yMax - yMin) * 0.08;
    return {
      xMin: Math.min(...xs),
      xMax: Math.max(...xs),
      yMin: Math.max(0, yMin - yPad),
      yMax: yMax + yPad,
    };
  }, [allPoints]);

  const xScale = useCallback(
    (t: number) => {
      if (domain.xMax === domain.xMin) return M.left + innerW / 2;
      return M.left + ((t - domain.xMin) / (domain.xMax - domain.xMin)) * innerW;
    },
    [domain, innerW, M.left],
  );
  const yScale = useCallback(
    (p: number) => {
      if (domain.yMax === domain.yMin) return M.top + innerH / 2;
      return M.top + (1 - (p - domain.yMin) / (domain.yMax - domain.yMin)) * innerH;
    },
    [domain, innerH, M.top],
  );

  // Y-axis ticks. Pick 4-5 tick values inside the padded domain.
  const yTicks = useMemo(() => {
    const range = domain.yMax - domain.yMin;
    if (range <= 0) return [domain.yMin];
    const step = niceStep(range / 4);
    const out: number[] = [];
    let v = Math.ceil(domain.yMin / step) * step;
    while (v <= domain.yMax) {
      out.push(v);
      v += step;
    }
    return out;
  }, [domain]);

  // X-axis ticks: first/mid/last date for narrow, more if wider.
  const xTicks = useMemo(() => {
    if (allPoints.length === 0) return [];
    const dates = Array.from(
      new Set(allPoints.map((p) => p.date)),
    ).sort();
    const n = width < 480 ? 3 : width < 800 ? 4 : 6;
    if (dates.length <= n) return dates;
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      out.push(dates[Math.floor((i * (dates.length - 1)) / (n - 1))]!);
    }
    return out;
  }, [allPoints, width]);

  const onMove = (evt: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    if (series.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mx = ((evt.clientX - rect.left) / rect.width) * width;
    // Find nearest point across all series
    let best: HoverState | null = null;
    let bestDist = Infinity;
    for (let si = 0; si < series.length; si++) {
      const pts = series[si]!.points;
      for (let pi = 0; pi < pts.length; pi++) {
        const t = Date.parse(pts[pi]!.date + 'T00:00:00Z');
        const px = xScale(t);
        const d = Math.abs(px - mx);
        if (d < bestDist) {
          bestDist = d;
          best = {
            seriesIndex: si,
            pointIndex: pi,
            x: px,
            y: yScale(pts[pi]!.price),
          };
        }
      }
    }
    setHover(best);
  };

  return (
    <div className={styles.plot} ref={wrapRef}>
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label="Price history chart"
      >
        {/* Y grid + labels */}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className={styles.gridLine}
              x1={M.left}
              x2={M.left + innerW}
              y1={yScale(tick)}
              y2={yScale(tick)}
            />
            <text
              className={styles.axis}
              x={M.left - 6}
              y={yScale(tick) + 3}
              textAnchor="end"
            >
              {formatCurrency(tick, currency)}
            </text>
          </g>
        ))}
        {/* X labels */}
        {xTicks.map((date) => {
          const t = Date.parse(date + 'T00:00:00Z');
          return (
            <text
              key={`x-${date}`}
              className={styles.axis}
              x={xScale(t)}
              y={height - 6}
              textAnchor="middle"
            >
              {formatDateShort(date)}
            </text>
          );
        })}
        {/* Series paths */}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const d = buildPath(s.points, xScale, yScale);
          const area = buildAreaPath(s.points, xScale, yScale, M.top + innerH);
          return (
            <g key={s.key}>
              <path className={styles.areaPath} d={area} fill={s.colour} />
              <path className={styles.linePath} d={d} stroke={s.colour} />
              {/* Emphasise the endpoint so a 2-point series is visible. */}
              {s.points.length > 0 && (
                <circle
                  className={styles.point}
                  cx={xScale(Date.parse(s.points.at(-1)!.date + 'T00:00:00Z'))}
                  cy={yScale(s.points.at(-1)!.price)}
                  r={2.5}
                  fill={s.colour}
                />
              )}
            </g>
          );
        })}
        {/* Crosshair + hover point */}
        {hover && series[hover.seriesIndex] && (
          <g>
            <line
              className={styles.crosshair}
              x1={hover.x}
              x2={hover.x}
              y1={M.top}
              y2={M.top + innerH}
            />
            <circle
              cx={hover.x}
              cy={hover.y}
              r={4}
              fill={series[hover.seriesIndex]!.colour}
              stroke="#05070c"
              strokeWidth={2}
            />
          </g>
        )}
      </svg>
      {hover && series[hover.seriesIndex] && (
        <div
          className={styles.tooltip}
          style={{
            left: `${(hover.x / width) * 100}%`,
            top: hover.y,
          }}
        >
          <div className={styles.tooltipDate}>
            {series[hover.seriesIndex]!.points[hover.pointIndex]!.date}
          </div>
          <div className={styles.tooltipRow}>
            <span
              className={styles.swatch}
              style={{ background: series[hover.seriesIndex]!.colour }}
            />
            <span>{series[hover.seriesIndex]!.label}</span>
            <strong>
              {formatCurrency(
                series[hover.seriesIndex]!.points[hover.pointIndex]!.price,
                series[hover.seriesIndex]!.currency,
              )}
            </strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ── SVG helpers ──────────────────────────────────────────────────

function buildPath(
  points: readonly PricePoint[],
  x: (t: number) => number,
  y: (p: number) => number,
): string {
  if (points.length === 0) return '';
  const parts: string[] = [];
  points.forEach((pt, i) => {
    const t = Date.parse(pt.date + 'T00:00:00Z');
    parts.push(`${i === 0 ? 'M' : 'L'}${x(t).toFixed(1)} ${y(pt.price).toFixed(1)}`);
  });
  return parts.join(' ');
}

function buildAreaPath(
  points: readonly PricePoint[],
  x: (t: number) => number,
  y: (p: number) => number,
  baseY: number,
): string {
  if (points.length === 0) return '';
  const line = buildPath(points, x, y);
  const first = Date.parse(points[0]!.date + 'T00:00:00Z');
  const last = Date.parse(points.at(-1)!.date + 'T00:00:00Z');
  return `${line} L${x(last).toFixed(1)} ${baseY.toFixed(1)} L${x(first).toFixed(1)} ${baseY.toFixed(1)} Z`;
}

function niceStep(rough: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const norm = rough / pow;
  let step: number;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7.5) step = 5;
  else step = 10;
  return step * pow;
}

function formatCurrency(value: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '';
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${symbol}${value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 })}`;
}

function formatDateShort(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
