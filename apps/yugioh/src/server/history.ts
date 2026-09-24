// Slice A: historical price composition for the Yu-Gi-Oh card and
// printing pages. Groups daily observations into per-series arrays
// the client-side chart can render without knowing about DB layout.
//
// A "series" is one line on the chart: one (currency × source) for
// retail, or one (grader × grade × currency) for graded.
//
// Every helper wraps its read in unstable_cache at the MARKET_SHORT
// TTL so a page refresh doesn't re-scan the daily tables. Never
// mixes attribution — printing-scoped and card-scoped queries stay
// in separate helpers.
//
// Series are returned already ordered by observedOn ascending and
// downsampled to at most SERIES_POINT_CAP points (LTTB would be
// overkill given production coverage is currently O(10-100) points
// per series — plain evenly-spaced decimation is honest and cheap).

import { unstable_cache } from 'next/cache';
import type {
  DailyGradedPoint,
  DailyRetailPoint,
} from '@collector-network/market-data';
import {
  getDailyCardScopedGraded,
  getDailyPrintingScopedGraded,
  getDailyRetailPrices,
} from '@collector-network/market-data';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';

// Upper bound on the number of points rendered per series. Charts
// with >~300 points on a mobile viewport become an unreadable smear;
// we decimate above the cap.
const SERIES_POINT_CAP = 300;

// ── Public shapes ────────────────────────────────────────────────

export interface RetailSeries {
  key: string;              // e.g. "tcgplayer:USD"
  label: string;            // "TCGplayer (USD)"
  source: string;           // full source id ("tcggraph.tcgplayer")
  currency: string;
  points: PricePoint[];
}

export interface GradedSeries {
  key: string;              // e.g. "psa/10/USD"
  label: string;            // "PSA 10 (USD)"
  grader: string;           // 'psa' | 'bgs' | 'cgc' | 'sgc' | 'raw' | 'any' | ...
  grade: string;            // '10' | '9.5' | 'ungraded' | ...
  currency: string;
  isRaw: boolean;           // grader === 'raw'
  points: PricePoint[];
}

export interface PricePoint {
  date: string;             // YYYY-MM-DD
  price: number;
}

export interface PriceHistorySummary {
  firstObservation: string | null;
  lastObservation: string | null;
  daysCovered: number;
}

export interface PrintingPriceHistory extends PriceHistorySummary {
  retail: RetailSeries[];
  gradedPrinting: GradedSeries[];
}

export interface CardScopedPriceHistory extends PriceHistorySummary {
  gradedCard: GradedSeries[];
}

// ── Grouping helpers ─────────────────────────────────────────────

function decimate<T>(rows: readonly T[], cap: number): T[] {
  if (rows.length <= cap) return [...rows];
  const step = rows.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) {
    out.push(rows[Math.floor(i * step)]!);
  }
  // Always include the last point so the "latest value" reads correctly.
  const last = rows[rows.length - 1]!;
  if (out.at(-1) !== last) out.push(last);
  return out;
}

function summariseCoverage(
  ...seriesSets: readonly { points: readonly PricePoint[] }[][]
): PriceHistorySummary {
  const dates: string[] = [];
  for (const set of seriesSets)
    for (const s of set) for (const p of s.points) dates.push(p.date);
  if (dates.length === 0)
    return { firstObservation: null, lastObservation: null, daysCovered: 0 };
  dates.sort();
  const first = dates[0]!;
  const last = dates.at(-1)!;
  // days-covered counts distinct calendar days observed anywhere in
  // the series set (not first-to-last span, which is inflated by
  // sparse-ingest gaps).
  const distinct = new Set(dates).size;
  return { firstObservation: first, lastObservation: last, daysCovered: distinct };
}

// Short label for a retail source id like "tcggraph.tcgplayer".
function retailSourceLabel(source: string): string {
  const tail = source.split('.').pop() ?? source;
  return tail.charAt(0).toUpperCase() + tail.slice(1);
}

// Short label for a graded series. Graders are lowercased short-codes
// in the DB ('psa', 'bgs', 'cgc', 'sgc', 'raw', 'any').
function gradedSeriesLabel(grader: string, grade: string, currency: string): string {
  if (grader === 'raw') return `Raw (${currency})`;
  if (grader === 'any') return `Grade ${grade} · any (${currency})`;
  return `${grader.toUpperCase()} ${grade} (${currency})`;
}

function groupRetail(points: readonly DailyRetailPoint[]): RetailSeries[] {
  const buckets = new Map<string, DailyRetailPoint[]>();
  for (const p of points) {
    if (p.price == null) continue;
    const key = `${p.source}::${p.currency}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key))!.push(p);
  }
  const out: RetailSeries[] = [];
  for (const [key, rows] of buckets) {
    rows.sort((a, b) => a.observedOn.localeCompare(b.observedOn));
    const decimated = decimate(rows, SERIES_POINT_CAP);
    const source = rows[0]!.source;
    const currency = rows[0]!.currency;
    out.push({
      key,
      label: `${retailSourceLabel(source)} (${currency})`,
      source,
      currency,
      points: decimated.map((r) => ({ date: r.observedOn, price: r.price! })),
    });
  }
  // Deterministic order: currency-alphabetical then source-alphabetical
  // so the chart legend stays stable across renders.
  out.sort((a, b) =>
    a.currency === b.currency ? a.source.localeCompare(b.source) : a.currency.localeCompare(b.currency),
  );
  return out;
}

function groupGraded(points: readonly DailyGradedPoint[]): GradedSeries[] {
  const buckets = new Map<string, DailyGradedPoint[]>();
  for (const p of points) {
    if (p.price == null) continue;
    const key = `${p.grader}::${p.grade}::${p.currency}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key))!.push(p);
  }
  const out: GradedSeries[] = [];
  for (const [key, rows] of buckets) {
    rows.sort((a, b) => a.observedOn.localeCompare(b.observedOn));
    const decimated = decimate(rows, SERIES_POINT_CAP);
    const first = rows[0]!;
    out.push({
      key,
      label: gradedSeriesLabel(first.grader, first.grade, first.currency),
      grader: first.grader,
      grade: first.grade,
      currency: first.currency,
      isRaw: first.grader === 'raw',
      points: decimated.map((r) => ({ date: r.observedOn, price: r.price! })),
    });
  }
  // Stable, useful order: raw first (as the always-reference series),
  // then graders alphabetical, then grade descending inside a grader.
  out.sort((a, b) => {
    if (a.isRaw !== b.isRaw) return a.isRaw ? -1 : 1;
    if (a.grader !== b.grader) return a.grader.localeCompare(b.grader);
    const na = Number(a.grade);
    const nb = Number(b.grade);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
    return a.grade.localeCompare(b.grade);
  });
  return out;
}

// ── Composition ──────────────────────────────────────────────────

async function _getPrintingPriceHistory(
  printingId: string,
): Promise<PrintingPriceHistory> {
  const supabase = getYugiohClient();
  const [retailRows, gradedRows] = await Promise.all([
    getDailyRetailPrices(supabase, printingId),
    getDailyPrintingScopedGraded(supabase, printingId),
  ]);
  const retail = groupRetail(retailRows);
  const gradedPrinting = groupGraded(gradedRows);
  return {
    retail,
    gradedPrinting,
    ...summariseCoverage(retail, gradedPrinting),
  };
}

async function _getCardScopedPriceHistory(
  cardId: string,
): Promise<CardScopedPriceHistory> {
  const supabase = getYugiohClient();
  const rows = await getDailyCardScopedGraded(supabase, cardId);
  const gradedCard = groupGraded(rows);
  return {
    gradedCard,
    ...summariseCoverage(gradedCard),
  };
}

// Cached exports. MARKET_SHORT (15 min) — matches page-level ISR and
// the existing market ranking cache TTL. Bypass flag honoured for
// scripts.
export const getYugiohPrintingPriceHistory = withCacheBypass(
  _getPrintingPriceHistory,
  unstable_cache(_getPrintingPriceHistory, ['ygo:printingHistory', 'v1'], {
    revalidate: CACHE_TTL.MARKET_SHORT,
    tags: [CACHE_TAGS.MARKET],
  }),
);

export const getYugiohCardScopedPriceHistory = withCacheBypass(
  _getCardScopedPriceHistory,
  unstable_cache(_getCardScopedPriceHistory, ['ygo:cardScopedHistory', 'v1'], {
    revalidate: CACHE_TTL.MARKET_SHORT,
    tags: [CACHE_TAGS.MARKET],
  }),
);

// ── Client-side helpers (pure) ───────────────────────────────────
// Exported for the client chart component and tests. All pure — no
// DB, no side effects.

export interface TimeRange {
  key: '7d' | '30d' | '90d' | '1y' | 'all';
  label: string;
  days: number | null; // null = all
}

export const TIME_RANGES: readonly TimeRange[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
];

// Which range chips make sense given actual coverage. A range needs
// at least 2 points inside it to plot meaningfully; otherwise we hide
// the chip so users never see a one-dot line.
export function availableRanges(
  seriesSets: readonly { points: readonly PricePoint[] }[][],
  daysCovered: number,
): TimeRange[] {
  // 'all' is always available when there's any point at all.
  const anyPoint = seriesSets.some((set) => set.some((s) => s.points.length > 0));
  if (!anyPoint) return [];
  return TIME_RANGES.filter((r) => {
    if (r.days == null) return true;
    // Show a range chip when we have at least as many observation
    // days as its span — otherwise it degenerates to the same data
    // "All" shows and is misleading.
    return daysCovered >= 2 && r.days <= Math.max(daysCovered, 7);
  });
}

// Clip a series to the last `days` of data. Kept pure so the chart
// component can drive range switching client-side without a re-fetch.
export function clipSeries<T extends { points: PricePoint[] }>(
  series: readonly T[],
  days: number | null,
  today: Date = new Date(),
): T[] {
  if (days == null) return [...series];
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return series.map((s) => ({
    ...s,
    points: s.points.filter((p) => p.date >= cutoffStr),
  }));
}

// Simple % change between first and last point of a series (or null
// if either endpoint is missing or first price is 0).
export function percentChange(points: readonly PricePoint[]): number | null {
  if (points.length < 2) return null;
  const a = points[0]!.price;
  const b = points.at(-1)!.price;
  if (a === 0) return null;
  return ((b - a) / a) * 100;
}
