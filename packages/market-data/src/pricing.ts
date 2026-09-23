import type { SupabaseClient } from '@collector-network/database';
import type {
  TcgGradedPriceCurrent,
  TcgMarketPriceCurrent,
} from '@collector-network/database';
import { isRawObservation, toGradedQuote, toRetailQuote } from './mappers';
import type {
  CardScopedPricing,
  GradedQuote,
  PrintingPricing,
  RetailQuote,
} from './types';

// Query helpers on top of tcg_market_prices_current and
// tcg_graded_prices_current. Game-agnostic. Never merges currencies.
// Never mixes raw grader observations into `graded[]`. Never mixes
// attribution='card' graded quotes into a printing-scoped result.

// ── Retail (unchanged) ─────────────────────────────────────────────
// Retail listings are always tied to a specific printing by nature —
// there is no "card-scoped retail" concept.

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

// ── Graded splitting (raw vs slab) ─────────────────────────────────

export interface GradedSplit {
  raw: GradedQuote[];
  graded: GradedQuote[];
}

// Splits a caller-supplied array into (raw, graded) buckets. Preserves
// the input's attribution — callers are responsible for pre-filtering
// attribution before calling this if they want a single-attribution
// split.
export function splitGradedRows(
  rows: readonly TcgGradedPriceCurrent[],
): GradedSplit {
  const raw: GradedQuote[] = [];
  const graded: GradedQuote[] = [];
  for (const row of rows) {
    const quote = toGradedQuote(row);
    if (isRawObservation(row)) raw.push(quote);
    else graded.push(quote);
  }
  return { raw, graded };
}

// ── Printing-scoped graded helpers (attribution='printing') ────────
// These are the ONLY graded helpers that may render underneath a
// specific edition/variant. Every read filters attribution='printing'
// at the query layer.

export async function getPrintingScopedGradedSplit(
  supabase: SupabaseClient,
  printingId: string,
): Promise<GradedSplit> {
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('tcg_printing_id', printingId)
    .eq('attribution', 'printing');
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getPrintingScopedGradedSplit(${printingId}): ${error.message}`,
    );
  }
  return splitGradedRows((data as TcgGradedPriceCurrent[] | null) ?? []);
}

export async function getPrintingScopedGradedSplitForPrintings(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, GradedSplit>> {
  const result = new Map<string, GradedSplit>();
  if (printingIds.length === 0) return result;
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .in('tcg_printing_id', [...printingIds])
    .eq('attribution', 'printing');
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getPrintingScopedGradedSplitForPrintings: ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  for (const printingId of printingIds) {
    result.set(printingId, { raw: [], graded: [] });
  }
  for (const row of rows) {
    if (row.tcg_printing_id == null) continue; // defensive: attribution='printing' rows must have a printing id
    const split = result.get(row.tcg_printing_id) ?? { raw: [], graded: [] };
    const quote = toGradedQuote(row);
    if (isRawObservation(row)) split.raw.push(quote);
    else split.graded.push(quote);
    result.set(row.tcg_printing_id, split);
  }
  return result;
}

// ── Card-scoped graded helpers (attribution='card') ────────────────
// These describe the card family as a whole. Must render in a clearly
// separate panel labelled "edition/variant unspecified" — must NEVER
// appear underneath a specific printing heading.

export async function getCardScopedPricing(
  supabase: SupabaseClient,
  tcgCardId: string,
): Promise<CardScopedPricing> {
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .eq('tcg_card_id', tcgCardId)
    .eq('attribution', 'card');
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getCardScopedPricing(${tcgCardId}): ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  const split = splitGradedRows(rows);
  return { cardId: tcgCardId, raw: split.raw, graded: split.graded };
}

export async function getCardScopedPricingForCards(
  supabase: SupabaseClient,
  tcgCardIds: readonly string[],
): Promise<Map<string, CardScopedPricing>> {
  const result = new Map<string, CardScopedPricing>();
  if (tcgCardIds.length === 0) return result;
  const { data, error } = await supabase
    .from('tcg_graded_prices_current')
    .select('*')
    .in('tcg_card_id', [...tcgCardIds])
    .eq('attribution', 'card');
  if (error) {
    throw new Error(
      `[@collector-network/market-data] getCardScopedPricingForCards: ${error.message}`,
    );
  }
  const rows = (data as TcgGradedPriceCurrent[] | null) ?? [];
  for (const cardId of tcgCardIds) {
    result.set(cardId, { cardId, raw: [], graded: [] });
  }
  for (const row of rows) {
    if (row.tcg_card_id == null) continue;
    const bucket = result.get(row.tcg_card_id) ?? {
      cardId: row.tcg_card_id,
      raw: [],
      graded: [],
    };
    const quote = toGradedQuote(row);
    if (isRawObservation(row)) bucket.raw.push(quote);
    else bucket.graded.push(quote);
    result.set(row.tcg_card_id, bucket);
  }
  return result;
}

// ── Convenience wrappers ───────────────────────────────────────────

// Printing page: everything safe to render underneath the exact
// printing heading (retail + attribution='printing' graded).
export async function getPrintingPricing(
  supabase: SupabaseClient,
  printingId: string,
): Promise<PrintingPricing> {
  const [market, gradedSplit] = await Promise.all([
    getRetailQuotes(supabase, printingId),
    getPrintingScopedGradedSplit(supabase, printingId),
  ]);
  return {
    printingId,
    market,
    raw: gradedSplit.raw,
    graded: gradedSplit.graded,
  };
}

// Batched: same shape as getPrintingPricing but for many printings.
export async function getPrintingPricingBatch(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, PrintingPricing>> {
  const [retailQuotes, gradedSplitMap] = await Promise.all([
    getRetailQuotesForPrintings(supabase, printingIds),
    getPrintingScopedGradedSplitForPrintings(supabase, printingIds),
  ]);
  const marketByPrinting = new Map<string, RetailQuote[]>();
  for (const printingId of printingIds) marketByPrinting.set(printingId, []);
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
