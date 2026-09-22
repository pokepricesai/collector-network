import type { SupabaseClient } from '@collector-network/database';
import type {
  TcgGradedPriceCurrent,
  TcgMarketPriceCurrent,
} from '@collector-network/database';
import { isRawObservation, toGradedQuote, toRetailQuote } from './mappers';
import type { GradedQuote, PrintingPricing, RetailQuote } from './types';

// Query helpers on top of tcg_market_prices_current and
// tcg_graded_prices_current. Game-agnostic. Never merges currencies. Never
// mixes raw grader observations into `graded[]`.

export async function getRetailQuotes(
  supabase: SupabaseClient,
  printingId: string,
): Promise<RetailQuote[]> {
  const { data, error } = await supabase
    .from('tcg_market_prices_current')
    .select('*')
    .eq('tcg_printing_id', printingId);
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getRetailQuotes(${printingId}): ${error.message}`,
    );
  }
  return ((data as TcgMarketPriceCurrent[] | null) ?? []).map(toRetailQuote);
}

export async function getRetailQuotesForPrintings(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<RetailQuote[]> {
  if (printingIds.length === 0) return [];
  const { data, error } = await supabase
    .from('tcg_market_prices_current')
    .select('*')
    .in('tcg_printing_id', [...printingIds]);
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getRetailQuotesForPrintings: ${error.message}`,
    );
  }
  return ((data as TcgMarketPriceCurrent[] | null) ?? []).map(toRetailQuote);
}

export interface GradedSplit {
  raw: GradedQuote[];
  graded: GradedQuote[];
}

// Fetches everything in tcg_graded_prices_current for the printing and
// splits it into `raw` (grader='raw') and `graded` (everything else).
export async function getGradedSplit(
  supabase: SupabaseClient,
  printingId: string,
): Promise<GradedSplit> {
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('tcg_printing_id', printingId);
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getGradedSplit(${printingId}): ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  return splitGradedRows(rows);
}

export async function getGradedSplitForPrintings(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, GradedSplit>> {
  const result = new Map<string, GradedSplit>();
  if (printingIds.length === 0) return result;
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .in('tcg_printing_id', [...printingIds]);
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getGradedSplitForPrintings: ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  for (const printingId of printingIds) {
    result.set(printingId, { raw: [], graded: [] });
  }
  for (const row of rows) {
    const split = result.get(row.tcg_printing_id) ?? { raw: [], graded: [] };
    if (isRawObservation(row)) {
      split.raw.push(toGradedQuote(row));
    } else {
      split.graded.push(toGradedQuote(row));
    }
    result.set(row.tcg_printing_id, split);
  }
  return result;
}

export function splitGradedRows(rows: readonly TcgGradedPriceCurrent[]): GradedSplit {
  const raw: GradedQuote[] = [];
  const graded: GradedQuote[] = [];
  for (const row of rows) {
    if (isRawObservation(row)) {
      raw.push(toGradedQuote(row));
    } else {
      graded.push(toGradedQuote(row));
    }
  }
  return { raw, graded };
}

// Convenience: one call, one printing, three arrays. Use this from
// per-app read layers when a single printing's pricing is what you need.
export async function getPrintingPricing(
  supabase: SupabaseClient,
  printingId: string,
): Promise<PrintingPricing> {
  const [market, gradedSplit] = await Promise.all([
    getRetailQuotes(supabase, printingId),
    getGradedSplit(supabase, printingId),
  ]);
  return {
    printingId,
    market,
    raw: gradedSplit.raw,
    graded: gradedSplit.graded,
  };
}

// Batched variant for card pages that need pricing across many printings.
export async function getPrintingPricingBatch(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, PrintingPricing>> {
  const [retailQuotes, gradedSplitMap] = await Promise.all([
    getRetailQuotesForPrintings(supabase, printingIds),
    getGradedSplitForPrintings(supabase, printingIds),
  ]);
  const marketByPrinting = new Map<string, RetailQuote[]>();
  for (const printingId of printingIds) {
    marketByPrinting.set(printingId, []);
  }
  for (const quote of retailQuotes) {
    const bucket = marketByPrinting.get(quote.printingId);
    if (bucket) bucket.push(quote);
  }
  const out = new Map<string, PrintingPricing>();
  for (const printingId of printingIds) {
    const split = gradedSplitMap.get(printingId) ?? { raw: [], graded: [] };
    out.set(printingId, {
      printingId,
      market: marketByPrinting.get(printingId) ?? [],
      raw: split.raw,
      graded: split.graded,
    });
  }
  return out;
}
