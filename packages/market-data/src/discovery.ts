import type {
  SupabaseClient,
  TcgGradedPriceCurrent,
  TcgMarketPriceCurrent,
} from '@collector-network/database';
import { isRawObservation, toGradedQuote, toRetailQuote } from './mappers';
import type { GradedQuote, RetailQuote } from './types';

// Discovery queries for homepage sections. Returns rows already mapped
// to the domain shapes so callers don't touch raw DB tables.

export interface TopRetailPrinting {
  printingId: string;
  quote: RetailQuote;
}

// "Most valuable printings" — top-N by price. Filters by currency to
// keep the ranking honest (never mix USD + EUR). Uses `price desc` on
// the current market table.
export async function getMostValuableRetailPrintings(
  supabase: SupabaseClient,
  gameId: string,
  options: {
    currency: 'USD' | 'EUR';
    limit?: number;
    minPrice?: number;
  },
): Promise<TopRetailPrinting[]> {
  const { currency, limit = 12, minPrice = 100 } = options;
  const { data, error } = await supabase
    .from('tcg_market_prices_current')
    .select('*')
    .eq('game_id', gameId)
    .eq('currency', currency)
    .gte('price', minPrice)
    .order('price', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getMostValuableRetailPrintings(${gameId}, ${currency}): ${error.message}`,
    );
  }
  const rows = (data as TcgMarketPriceCurrent[] | null) ?? [];
  return rows.map((row) => ({
    printingId: row.tcg_printing_id,
    quote: toRetailQuote(row),
  }));
}

export interface TopGradedPrinting {
  printingId: string;
  quote: GradedQuote;
}

// Top graded slabs. Filters out `grader='raw'` at the query layer AND
// re-guards at the map layer (defence in depth).
export async function getMostValuableGradedPrintings(
  supabase: SupabaseClient,
  gameId: string,
  options: {
    limit?: number;
    minPrice?: number;
    onlyGrade10?: boolean;
  } = {},
): Promise<TopGradedPrinting[]> {
  const { limit = 12, minPrice = 200, onlyGrade10 = true } = options;
  let query = supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('game_id', gameId)
    .neq('grader', 'raw')
    .gte('price', minPrice)
    .order('price', { ascending: false })
    .limit(limit);
  if (onlyGrade10) {
    query = query.eq('grade', '10');
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getMostValuableGradedPrintings(${gameId}): ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  return rows
    .filter((row) => !isRawObservation(row))
    .map((row) => ({
      printingId: row.tcg_printing_id,
      quote: toGradedQuote(row),
    }));
}
