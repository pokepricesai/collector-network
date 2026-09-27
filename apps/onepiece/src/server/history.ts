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
  const gameId = await getOnepieceGameId(supabase);
  const { data, error } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on, source, currency, finish, price')
    .eq('game_id', gameId)
    .eq('tcg_printing_id', printingId)
    .not('price', 'is', null)
    .order('observed_on', { ascending: true });
  if (error) {
    throw new Error(
      `[apps/onepiece] getPrintingHistory(${printingId}): ${error.message}`,
    );
  }
  const rows = (data as DailyRow[] | null) ?? [];
  if (rows.length === 0) {
    return { series: [], observedFrom: null, observedTo: null };
  }
  const bySeries = new Map<string, HistorySeries>();
  for (const r of rows) {
    if (r.price == null) continue;
    const key = `${r.source}|${r.currency}|${r.finish ?? ''}`;
    const bucket = bySeries.get(key);
    const point: HistoryPoint = { observedOn: r.observed_on, price: r.price };
    if (bucket) {
      bucket.points.push(point);
    } else {
      bySeries.set(key, {
        source: r.source,
        currency: r.currency,
        finish: r.finish,
        points: [point],
      });
    }
  }
  const series = [...bySeries.values()];
  return {
    series,
    observedFrom: rows[0]!.observed_on,
    observedTo: rows[rows.length - 1]!.observed_on,
  };
}
