import 'server-only';
import type { SupabaseClient } from '@collector-network/database';
import { getOnepieceClient, getOnepieceGameId } from './client';
import type { HeadlineSignal } from '../lib/onepiece/pick-headline';

// Daily-history reads for a printing.
//
// Production reality (docs/onepiece/data-audit.md §B / probe-supplementary.mts):
// the tcg_market_price_daily table for OP only covers ~2 weeks as of
// the audit — ingest is fresh. We return whatever's there and let the
// UI degrade gracefully.
//
// Never merges currencies. Each series carries the DB field it plots
// (`avg_30d`, `price_low`, or the current top listing `price`) so the
// UI can label the sparkline honestly instead of implying "sparkline
// value = headline price" when they may be different signals.

export interface HistoryPoint {
  observedOn: string; // YYYY-MM-DD
  price: number;
}

export interface HistorySeries {
  source: string;
  currency: string;
  /** Kept for backwards-compat; today always `null` because we merge
   *  finish rows that share a marketplace product id. */
  finish: string | null;
  /** The DB column each point's value was read from. Ties the
   *  sparkline caption to the same signal wording the headline uses,
   *  so a "30-day average" headline plots the 30-day average history
   *  (not the listing-trend column). */
  signal: HeadlineSignal;
  points: HistoryPoint[];
}

export interface HistoryBundle {
  series: HistorySeries[];
  observedFrom: string | null; // earliest date across every series
  observedTo: string | null;   // latest date across every series
}

interface DailyRow {
  observed_on: string;
  source: string;
  currency: string;
  finish: string | null;
  price: number | null;
  price_low: number | null;
  avg_30d: number | null;
}

/** Preferred signal per source. Callers pass this so history plots
 *  the same field the headline picked; falls through to trend/priceLow
 *  when the preferred field is null on a given day. */
export type HistorySignalPreference = Partial<Record<'cardmarket' | 'tcgplayer', HeadlineSignal>>;

function readSignal(row: DailyRow, signal: HeadlineSignal): number | null {
  switch (signal) {
    case 'avg30d':   return row.avg_30d;
    case 'priceLow': return row.price_low;
    case 'trend':    return row.price;
  }
}

/** Pick the best-available signal for one daily row given a caller's
 *  preference. Returns null if none of the fields are populated for
 *  that day. */
function chooseValue(row: DailyRow, prefer: HeadlineSignal): { value: number; signal: HeadlineSignal } | null {
  const order: HeadlineSignal[] = prefer === 'avg30d'
    ? ['avg30d', 'priceLow', 'trend']
    : prefer === 'priceLow'
    ? ['priceLow', 'avg30d', 'trend']
    : ['trend', 'avg30d', 'priceLow'];
  for (const s of order) {
    const v = readSignal(row, s);
    if (v != null) return { value: v, signal: s };
  }
  return null;
}

function sourceKey(raw: string | null | undefined): 'cardmarket' | 'tcgplayer' | null {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('cardmarket')) return 'cardmarket';
  if (s.includes('tcgplayer')) return 'tcgplayer';
  return null;
}

export async function getPrintingHistory(
  printingId: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<HistoryBundle> {
  return getVariantHistory([printingId], undefined, supabase);
}

/** Variant-scoped daily history. Accepts every printing id on this
 *  collectible variant (finish × language rows) and merges each
 *  (source, currency) pair into a single series. `signalPreference`
 *  tells us which DB column to plot per source; the returned series
 *  reports the signal actually used for the majority of its points so
 *  the sparkline caption reads honestly ("Cardmarket 30-day average
 *  history", not "Price history"). */
export async function getVariantHistory(
  printingIds: readonly string[],
  signalPreference: HistorySignalPreference = {},
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<HistoryBundle> {
  if (printingIds.length === 0) {
    return { series: [], observedFrom: null, observedTo: null };
  }
  const gameId = await getOnepieceGameId(supabase);
  const { data, error } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on, source, currency, finish, price, price_low, avg_30d')
    .eq('game_id', gameId)
    .in('tcg_printing_id', printingIds as string[])
    .order('observed_on', { ascending: true });
  if (error) {
    throw new Error(
      `[apps/onepiece] getVariantHistory(${printingIds.join(',')}): ${error.message}`,
    );
  }
  const rows = (data as DailyRow[] | null) ?? [];
  if (rows.length === 0) {
    return { series: [], observedFrom: null, observedTo: null };
  }
  // Group by (source, currency). Finish is intentionally NOT part of
  // the key — Cardmarket / TCGPlayer treat the marketplace product as
  // one entity across finishes for OP, so a single time series is the
  // honest view.
  interface Bucket {
    source: string;
    currency: string;
    // observed_on -> { value, signal }
    byDate: Map<string, { value: number; signal: HeadlineSignal }>;
    signalCounts: Record<HeadlineSignal, number>;
  }
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const sourceTag = sourceKey(r.source);
    const prefer: HeadlineSignal = (sourceTag && signalPreference[sourceTag]) || 'trend';
    const picked = chooseValue(r, prefer);
    if (!picked) continue;
    const key = `${r.source}|${r.currency}`;
    const bucket = buckets.get(key) ?? {
      source: r.source,
      currency: r.currency,
      byDate: new Map<string, { value: number; signal: HeadlineSignal }>(),
      signalCounts: { avg30d: 0, priceLow: 0, trend: 0 },
    };
    const prev = bucket.byDate.get(r.observed_on);
    // Same-day dupes across finishes: prefer the entry whose signal
    // matches the caller's preference; then the higher value. That way
    // a foil-row `avg_30d` beats a nonfoil-row `price` even if the
    // latter is numerically higher on that day.
    if (!prev || (picked.signal === prefer && prev.signal !== prefer) || (prev.signal === picked.signal && picked.value > prev.value)) {
      bucket.byDate.set(r.observed_on, picked);
    }
    buckets.set(key, bucket);
  }
  const series: HistorySeries[] = [];
  for (const b of buckets.values()) {
    // Tally which signal won the majority of days to label the whole
    // series. If callers didn't declare a preference, this picks the
    // most-populated column for this source.
    for (const entry of b.byDate.values()) b.signalCounts[entry.signal] += 1;
    const majoritySignal: HeadlineSignal =
      b.signalCounts.avg30d >= b.signalCounts.priceLow && b.signalCounts.avg30d >= b.signalCounts.trend
        ? 'avg30d'
        : b.signalCounts.priceLow >= b.signalCounts.trend
        ? 'priceLow'
        : 'trend';
    const points = [...b.byDate.entries()]
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([observedOn, entry]) => ({ observedOn, price: entry.value }));
    series.push({
      source: b.source,
      currency: b.currency,
      finish: null,
      signal: majoritySignal,
      points,
    });
  }
  return {
    series,
    observedFrom: rows[0]!.observed_on,
    observedTo: rows[rows.length - 1]!.observed_on,
  };
}
