import { unstable_cache } from 'next/cache';
import {
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import {
  getMostValuableGradedPrintings,
  getMostValuableRetailPrintings,
  type GradedQuote,
  type RetailQuote,
} from '@collector-network/market-data';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';
import { safe } from './safe';

const YGO_GAME_ID = 'ygo';

// Vintage cutoff. Everything with a set released before 2011-01-01
// counts as vintage — that's the pre-Xyz era (LOB through STOR),
// which is what the collector community typically means when they say
// "vintage Yu-Gi-Oh!". Adjust here if community definition shifts.
export const VINTAGE_CUTOFF = '2011-01-01';

// ── Public shapes ────────────────────────────────────────────────

export interface RetailRankingEntry {
  printing: TcgPrinting;
  card: TcgCard;
  set: TcgSet | null;
  quote: RetailQuote;
}

export interface GradedRankingEntry {
  printing: TcgPrinting;
  card: TcgCard;
  set: TcgSet | null;
  quote: GradedQuote;
}

export interface MarketHomeData {
  topRetailUsd: RetailRankingEntry[];
  topRetailEur: RetailRankingEntry[];
  topGraded: GradedRankingEntry[];
  topVintage: RetailRankingEntry[];
  fetchedAt: string;
  errors: string[];
}

// ── Helpers ──────────────────────────────────────────────────────

async function loadPrintingsWithCardsAndSets(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<{
  printingsById: Map<string, TcgPrinting>;
  cardsById: Map<string, TcgCard>;
  setsById: Map<string, TcgSet>;
}> {
  if (printingIds.length === 0) {
    return {
      printingsById: new Map(),
      cardsById: new Map(),
      setsById: new Map(),
    };
  }
  // Batch the `in(...)` list — a UUID-per-item URL query string over
  // ~500 IDs is enough to push PostgREST past the URL length limit and
  // return `Bad Request`. 200 keeps every batch well under the cap.
  const printings: TcgPrinting[] = [];
  for (let i = 0; i < printingIds.length; i += 200) {
    const batch = printingIds.slice(i, i + 200);
    const { data: printingRows, error: pErr } = await supabase
      .from('tcg_printings')
      .select('*')
      .in('id', [...batch]);
    if (pErr) throw new Error(`[yugioh/market] printings: ${pErr.message}`);
    printings.push(...((printingRows as TcgPrinting[] | null) ?? []));
  }
  const printingsById = new Map(printings.map((p) => [p.id, p]));

  const cardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const cardsById = new Map<string, TcgCard>();
  for (let i = 0; i < cardIds.length; i += 500) {
    const batch = cardIds.slice(i, i + 500);
    const { data: cardRows, error: cErr } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', batch);
    if (cErr) throw new Error(`[yugioh/market] cards: ${cErr.message}`);
    for (const c of (cardRows as TcgCard[] | null) ?? []) cardsById.set(c.id, c);
  }

  const setIds = Array.from(new Set(printings.map((p) => p.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  return { printingsById, cardsById, setsById };
}

// ── Retail rankings (currency-preserved) ─────────────────────────

export interface MostValuableOptions {
  currency: 'USD' | 'EUR';
  limit?: number;
  minPrice?: number;
}

async function _getYugiohMostValuableRetail(
  currency: 'USD' | 'EUR',
  limit: number,
  minPrice: number,
): Promise<RetailRankingEntry[]> {
  const supabase = getYugiohClient();
  const top = await getMostValuableRetailPrintings(supabase, YGO_GAME_ID, {
    currency,
    limit,
    minPrice,
  });
  if (top.length === 0) return [];
  const printingIds = top.map((t) => t.printingId);
  const { printingsById, cardsById, setsById } = await loadPrintingsWithCardsAndSets(
    supabase,
    printingIds,
  );
  const entries: RetailRankingEntry[] = [];
  for (const t of top) {
    const printing = printingsById.get(t.printingId);
    if (!printing) continue;
    const card = cardsById.get(printing.tcg_card_id);
    if (!card) continue;
    entries.push({
      printing,
      card,
      set: setsById.get(printing.set_id) ?? null,
      quote: t.quote,
    });
  }
  return entries;
}

// Market rankings cache — 15 minutes. Currency and limit are part of
// the cache key so USD-100 and EUR-100 do not collide, and the market
// home's 12-row bundle does not evict the /market/most-valuable 100-row
// bundle.
const cachedMostValuableRetail = withCacheBypass(
  _getYugiohMostValuableRetail,
  unstable_cache(_getYugiohMostValuableRetail, ['ygo:mostValuableRetail', 'v1'], {
    revalidate: CACHE_TTL.MARKET_SHORT,
    tags: [CACHE_TAGS.MARKET],
  }),
);

export async function getYugiohMostValuableRetail(
  options: MostValuableOptions,
): Promise<RetailRankingEntry[]> {
  const { currency, limit = 100, minPrice = 20 } = options;
  return cachedMostValuableRetail(currency, limit, minPrice);
}

// ── Graded rankings (printing-scoped only) ───────────────────────

export interface MostValuableGradedOptions {
  limit?: number;
  minPrice?: number;
  onlyGrade10?: boolean;
}

async function _getYugiohMostValuableGraded(
  limit: number,
  minPrice: number,
  onlyGrade10: boolean,
): Promise<GradedRankingEntry[]> {
  const supabase = getYugiohClient();
  const top = await getMostValuableGradedPrintings(supabase, YGO_GAME_ID, {
    limit,
    minPrice,
    onlyGrade10,
  });
  if (top.length === 0) return [];
  const printingIds = top.map((t) => t.printingId);
  const { printingsById, cardsById, setsById } = await loadPrintingsWithCardsAndSets(
    supabase,
    printingIds,
  );
  const entries: GradedRankingEntry[] = [];
  for (const t of top) {
    const printing = printingsById.get(t.printingId);
    if (!printing) continue;
    const card = cardsById.get(printing.tcg_card_id);
    if (!card) continue;
    entries.push({
      printing,
      card,
      set: setsById.get(printing.set_id) ?? null,
      quote: t.quote,
    });
  }
  return entries;
}

const cachedMostValuableGraded = withCacheBypass(
  _getYugiohMostValuableGraded,
  unstable_cache(_getYugiohMostValuableGraded, ['ygo:mostValuableGraded', 'v1'], {
    revalidate: CACHE_TTL.MARKET_SHORT,
    tags: [CACHE_TAGS.MARKET],
  }),
);

export async function getYugiohMostValuableGraded(
  options: MostValuableGradedOptions = {},
): Promise<GradedRankingEntry[]> {
  const { limit = 100, minPrice = 100, onlyGrade10 = true } = options;
  return cachedMostValuableGraded(limit, minPrice, onlyGrade10);
}

// ── Vintage rankings ────────────────────────────────────────────

// Approach:
//   1. Fetch vintage set IDs (sets released_at < VINTAGE_CUTOFF)
//   2. Fetch top N USD retail prices from tcg_market_prices_current
//   3. Join to printings + sets application-side; keep those whose
//      set_id is in the vintage set list
//   4. Trim to requested limit
// Fetching more than needed at step 2 gives us headroom to filter
// enough vintage results even when modern chase cards dominate the
// top of the raw retail table.
async function _getYugiohVintageMostValuable(
  currency: 'USD' | 'EUR',
  limit: number,
): Promise<RetailRankingEntry[]> {
  const supabase = getYugiohClient();

  // Vintage set IDs
  const { data: setRows, error: sErr } = await supabase
    .from('tcg_sets')
    .select('id,released_at')
    .eq('game_id', YGO_GAME_ID)
    .lt('released_at', VINTAGE_CUTOFF);
  if (sErr) throw new Error(`[yugioh/market] vintage sets: ${sErr.message}`);
  const vintageSetIds = new Set(
    ((setRows as Array<{ id: string; released_at: string | null }> | null) ??
      []).map((r) => r.id),
  );
  if (vintageSetIds.size === 0) return [];

  // Broad top retail — we over-fetch because vintage is a subset of
  // the global top USD list. limit×4 usually covers it; if not we're
  // safe with the smaller sample.
  const scanLimit = Math.min(1000, limit * 8);
  const top = await getMostValuableRetailPrintings(supabase, YGO_GAME_ID, {
    currency,
    limit: scanLimit,
    minPrice: 20,
  });
  if (top.length === 0) return [];

  const printingIds = top.map((t) => t.printingId);
  const { printingsById, cardsById, setsById } = await loadPrintingsWithCardsAndSets(
    supabase,
    printingIds,
  );

  const entries: RetailRankingEntry[] = [];
  for (const t of top) {
    const printing = printingsById.get(t.printingId);
    if (!printing || !vintageSetIds.has(printing.set_id)) continue;
    const card = cardsById.get(printing.tcg_card_id);
    if (!card) continue;
    entries.push({
      printing,
      card,
      set: setsById.get(printing.set_id) ?? null,
      quote: t.quote,
    });
    if (entries.length >= limit) break;
  }
  return entries;
}

const cachedVintageMostValuable = withCacheBypass(
  _getYugiohVintageMostValuable,
  unstable_cache(_getYugiohVintageMostValuable, ['ygo:vintageMostValuable', 'v1'], {
    revalidate: CACHE_TTL.MARKET_SHORT,
    tags: [CACHE_TAGS.MARKET],
  }),
);

export async function getYugiohVintageMostValuable(
  options: { currency?: 'USD' | 'EUR'; limit?: number } = {},
): Promise<RetailRankingEntry[]> {
  const { currency = 'USD', limit = 60 } = options;
  return cachedVintageMostValuable(currency, limit);
}

// ── Market home ─────────────────────────────────────────────────

export async function getYugiohMarketHomeData(): Promise<MarketHomeData> {
  const errors: string[] = [];
  const [usdResult, eurResult, gradedResult, vintageResult] = await Promise.all(
    [
      safe('market/topRetailUsd', () =>
        getYugiohMostValuableRetail({ currency: 'USD', limit: 12 }),
      ),
      safe('market/topRetailEur', () =>
        getYugiohMostValuableRetail({ currency: 'EUR', limit: 8 }),
      ),
      safe('market/topGraded', () =>
        getYugiohMostValuableGraded({ limit: 12, minPrice: 200 }),
      ),
      safe('market/topVintage', () =>
        getYugiohVintageMostValuable({ currency: 'USD', limit: 12 }),
      ),
    ],
  );

  function collect<T>(
    r: { ok: true; value: T; error: null } | { ok: false; value: null; error: string },
    label: string,
    fallback: T,
  ): T {
    if (r.ok) return r.value;
    errors.push(`${label}: ${r.error}`);
    return fallback;
  }

  return {
    topRetailUsd: collect(usdResult, 'topRetailUsd', []),
    topRetailEur: collect(eurResult, 'topRetailEur', []),
    topGraded: collect(gradedResult, 'topGraded', []),
    topVintage: collect(vintageResult, 'topVintage', []),
    fetchedAt: new Date().toISOString(),
    errors,
  };
}
