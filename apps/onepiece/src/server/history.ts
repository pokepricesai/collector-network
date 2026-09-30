import 'server-only';
import type { SupabaseClient } from '@collector-network/database';
import { getOnepieceClient, getOnepieceGameId } from './client';

// Daily-history reads for a printing.
//
// Production reality (docs/onepiece/data-audit.md §B / probe-supplementary.mts):
// the tcg_market_price_daily table for OP only covers ~3 days as of the
// audit — ingest is fresh. We return whatever's there and let the UI
// degrade gracefully.
//
// Never merges currencies: the return shape is one series per
// (source, currency) pair.

export interface HistoryPoint {
  observedOn: string; // YYYY-MM-DD
  price: number;
}

export interface HistorySeries {
  source: string;
  currency: string;
  finish: string | null;
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
}

export async function getPrintingHistory(
  printingId: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<HistoryBundle> {
  return getVariantHistory([printingId], supabase);
}

/** Variant-scoped daily history: accepts every printing id on this
 *  collectible variant (finish × language rows) and merges each
 *  (source, currency) pair into a single series. When two finish
 *  rows share a Cardmarket / TCGPlayer product they will report the
 *  same price on the same date; we dedupe by `observed_on` keeping
 *  the freshest / highest quote. Never merges currencies. */
export async function getVariantHistory(
  printingIds: readonly string[],
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<HistoryBundle> {
  if (printingIds.length === 0) {
    return { series: [], observedFrom: null, observedTo: null };
  }
  const gameId = await getOnepieceGameId(supabase);
  const { data, error } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on, source, currency, finish, price')
    .eq('game_id', gameId)
    .in('tcg_printing_id', printingIds as string[])
    .not('price', 'is', null)
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
  const bySeries = new Map<string, { source: string; currency: string; byDate: Map<string, number> }>();
  for (const r of rows) {
    if (r.price == null) continue;
    const key = `${r.source}|${r.currency}`;
    const bucket = bySeries.get(key) ?? { source: r.source, currency: r.currency, byDate: new Map<string, number>() };
    const prev = bucket.byDate.get(r.observed_on);
    // Same-day dupes across finishes: keep the higher price (foil is
    // usually ≥ nonfoil, and the marketplace product row is anchored
    // to the higher signal in the current feed).
    if (prev == null || r.price > prev) bucket.byDate.set(r.observed_on, r.price);
    bySeries.set(key, bucket);
  }
  const series: HistorySeries[] = [];
  for (const b of bySeries.values()) {
    const points = [...b.byDate.entries()]
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([observedOn, price]) => ({ observedOn, price }));
    series.push({ source: b.source, currency: b.currency, finish: null, points });
  }
  return {
    series,
    observedFrom: rows[0]!.observed_on,
    observedTo: rows[rows.length - 1]!.observed_on,
  };
}
