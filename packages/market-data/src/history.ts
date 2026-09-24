// Historical daily-snapshot readers. Query the tcg_market_price_daily
// and tcg_graded_price_daily tables (forward-accumulating, one row
// per (printing/card × observed_on × currency × source/grader/grade)).
//
// Attribution rules match the current-quote helpers:
//   - retail is always printing-scoped by nature
//   - graded 'printing' attribution → renderable under an exact
//     edition/variant heading
//   - graded 'card' attribution → must render in a separately-labelled
//     card-family panel, NEVER underneath a specific printing
//
// Every helper preserves currency and never averages/rolls quotes
// across sources or currencies.

import type { SupabaseClient } from '@collector-network/database';
import type {
  DailyGradedPoint,
  DailyRetailPoint,
} from './types';

// Row shapes as they come back from Supabase (snake_case).
interface DbDailyRetailRow {
  tcg_printing_id: string;
  observed_on: string;
  source: string;
  list_type: string | null;
  currency: string;
  finish: string | null;
  price: number | null;
  price_low: number | null;
  price_trend: number | null;
  avg_1d: number | null;
  avg_7d: number | null;
  avg_30d: number | null;
}

interface DbDailyGradedRow {
  tcg_printing_id: string | null;
  tcg_card_id: string | null;
  attribution: 'printing' | 'card';
  observed_on: string;
  grader: string;
  grade: string;
  currency: string;
  price: number | null;
  card_sales_volume: number | null;
}

function toDailyRetail(row: DbDailyRetailRow): DailyRetailPoint {
  return {
    printingId: row.tcg_printing_id,
    observedOn: row.observed_on,
    source: row.source,
    listType: row.list_type,
    currency: row.currency,
    finish: row.finish,
    price: row.price,
    priceLow: row.price_low,
    priceTrend: row.price_trend,
    avg1d: row.avg_1d,
    avg7d: row.avg_7d,
    avg30d: row.avg_30d,
  };
}

function toDailyGraded(row: DbDailyGradedRow): DailyGradedPoint {
  return {
    printingId: row.tcg_printing_id,
    cardId: row.tcg_card_id,
    attribution: row.attribution,
    observedOn: row.observed_on,
    grader: row.grader,
    grade: row.grade,
    currency: row.currency,
    price: row.price,
    cardSalesVolume: row.card_sales_volume,
  };
}

// ── Retail history (printing-scoped) ──────────────────────────────

export interface DailyRangeOptions {
  // Inclusive lower bound, YYYY-MM-DD. Omit to fetch all history.
  since?: string;
}

export async function getDailyRetailPrices(
  supabase: SupabaseClient,
  printingId: string,
  options: DailyRangeOptions = {},
): Promise<DailyRetailPoint[]> {
  let query = supabase
    .from('tcg_market_price_daily')
    .select(
      'tcg_printing_id, observed_on, source, list_type, currency, finish, price, price_low, price_trend, avg_1d, avg_7d, avg_30d',
    )
    .eq('tcg_printing_id', printingId)
    .not('price', 'is', null)
    .order('observed_on', { ascending: true });
  if (options.since) query = query.gte('observed_on', options.since);
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getDailyRetailPrices(${printingId}): ${error.message}`,
    );
  }
  return ((data as DbDailyRetailRow[] | null) ?? []).map(toDailyRetail);
}

// ── Graded history (printing-scoped) ──────────────────────────────
// Only attribution='printing' rows. Safe to render under a specific
// edition/variant heading.

export async function getDailyPrintingScopedGraded(
  supabase: SupabaseClient,
  printingId: string,
  options: DailyRangeOptions = {},
): Promise<DailyGradedPoint[]> {
  let query = supabase
    .from('tcg_graded_price_daily')
    .select(
      'tcg_printing_id, tcg_card_id, attribution, observed_on, grader, grade, currency, price, card_sales_volume',
    )
    .eq('tcg_printing_id', printingId)
    .eq('attribution', 'printing')
    .not('price', 'is', null)
    .order('observed_on', { ascending: true });
  if (options.since) query = query.gte('observed_on', options.since);
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getDailyPrintingScopedGraded(${printingId}): ${error.message}`,
    );
  }
  return ((data as DbDailyGradedRow[] | null) ?? []).map(toDailyGraded);
}

// ── Graded history (card-scoped) ──────────────────────────────────
// Only attribution='card' rows. Must render in a labelled "edition/
// variant unspecified" panel, never underneath a specific printing.

export async function getDailyCardScopedGraded(
  supabase: SupabaseClient,
  cardId: string,
  options: DailyRangeOptions = {},
): Promise<DailyGradedPoint[]> {
  let query = supabase
    .from('tcg_graded_price_daily')
    .select(
      'tcg_printing_id, tcg_card_id, attribution, observed_on, grader, grade, currency, price, card_sales_volume',
    )
    .eq('tcg_card_id', cardId)
    .eq('attribution', 'card')
    .not('price', 'is', null)
    .order('observed_on', { ascending: true });
  if (options.since) query = query.gte('observed_on', options.since);
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getDailyCardScopedGraded(${cardId}): ${error.message}`,
    );
  }
  return ((data as DbDailyGradedRow[] | null) ?? []).map(toDailyGraded);
}
