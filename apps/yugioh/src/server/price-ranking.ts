import { unstable_cache } from 'next/cache';
import type { SupabaseClient } from '@collector-network/database';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';

// Price-first identity ranking. The Card Finder's old flow ("scan all
// identities → fan out to fetch every price → sort in memory") could
// not run against the full 14k-identity YGO catalogue without hitting
// PostgREST timeouts, so anything larger than IDENTITY_PRICE_CAP fell
// back to alphabetical order. That was silent and wrong.
//
// This module flips the direction: query tcg_market_prices_current
// directly for a single (game_id, source, currency), ordered by price,
// and page-scan the *entire* eligible price feed. For each printing we
// resolve tcg_printing_id → tcg_card_id → name, dedupe to identity,
// and keep the first-seen price (max for price-desc, min for price-
// asc). The result is a fully ordered identity list with zero silent
// exclusion.
//
// The scan is expensive (44k rows for one source) but cached for
// CACHE_TTL.MARKET_SHORT so real users almost always hit a warm entry.

const YGO_GAME_ID = 'ygo';

// Row cap on the price scan. YGO has ~44k rows per source in
// tcg_market_prices_current; 60k gives ~35% headroom without letting
// a runaway query pull unbounded data.
const PRICE_SCAN_ROW_CAP = 60_000;
const PRICE_SCAN_CHUNK = 1000;

// Batch size for the printing → card resolution. 500 is the PostgREST
// URL-length budget for our id strings.
const RESOLVE_BATCH = 500;

export type PriceRankSource = 'tcggraph.tcgplayer' | 'tcggraph.cardmarket';
export type PriceRankCurrency = 'USD' | 'EUR';
export type PriceRankDirection = 'asc' | 'desc';

export interface RankedIdentity {
  identityKey: string;           // lowercase(name)
  representativeCardId: string;  // tcg_cards.id used for hydration
  price: number;                 // best price for this identity in the ranked direction
}

interface RawPriceRow {
  tcg_printing_id: string;
  price: number;
}

interface ResolvedPrintingRow {
  id: string;
  tcg_card_id: string;
}

interface ResolvedCardRow {
  id: string;
  name: string;
}

async function _rankIdentitiesByPrice(
  source: PriceRankSource,
  currency: PriceRankCurrency,
  direction: PriceRankDirection,
): Promise<RankedIdentity[]> {
  const supabase = getYugiohClient();

  //  Step 1 — page-scan the price rows ordered by price. Filtering
  //  price IS NOT NULL is done Postgres-side via .not() so we do not
  //  waste bandwidth on rows we would discard.
  const priceRows: RawPriceRow[] = [];
  for (let from = 0; from < PRICE_SCAN_ROW_CAP; from += PRICE_SCAN_CHUNK) {
    const to = from + PRICE_SCAN_CHUNK - 1;
    const { data, error } = await supabase
      .from('tcg_market_prices_current')
      .select('tcg_printing_id, price')
      .eq('game_id', YGO_GAME_ID)
      .eq('source', source)
      .eq('currency', currency)
      .not('price', 'is', null)
      .order('price', { ascending: direction === 'asc' })
      .range(from, to);
    if (error) {
      throw new Error(
        `[yugioh/price-ranking] scan(${source},${currency},${direction}): ${error.message}`,
      );
    }
    const rows = (data as RawPriceRow[] | null) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (r.price == null || !Number.isFinite(r.price)) continue;
      priceRows.push(r);
    }
    if (rows.length < PRICE_SCAN_CHUNK) break;
  }

  if (priceRows.length === 0) return [];

  //  Step 2 — resolve tcg_printing_id → tcg_card_id in batches. We
  //  preserve the price order established above by driving the join
  //  from priceRows, so ordering is stable across the resolution step.
  const uniquePrintingIds = Array.from(new Set(priceRows.map((r) => r.tcg_printing_id)));
  const cardIdByPrintingId = new Map<string, string>();
  for (let i = 0; i < uniquePrintingIds.length; i += RESOLVE_BATCH) {
    const batch = uniquePrintingIds.slice(i, i + RESOLVE_BATCH);
    const { data, error } = await supabase
      .from('tcg_printings')
      .select('id, tcg_card_id')
      .in('id', batch);
    if (error) {
      throw new Error(
        `[yugioh/price-ranking] resolve printings: ${error.message}`,
      );
    }
    for (const r of (data as ResolvedPrintingRow[] | null) ?? []) {
      cardIdByPrintingId.set(r.id, r.tcg_card_id);
    }
  }

  //  Step 3 — resolve tcg_card_id → name. Same batch strategy.
  const uniqueCardIds = Array.from(new Set([...cardIdByPrintingId.values()]));
  const nameByCardId = new Map<string, string>();
  for (let i = 0; i < uniqueCardIds.length; i += RESOLVE_BATCH) {
    const batch = uniqueCardIds.slice(i, i + RESOLVE_BATCH);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('id, name')
      .in('id', batch);
    if (error) {
      throw new Error(
        `[yugioh/price-ranking] resolve cards: ${error.message}`,
      );
    }
    for (const r of (data as ResolvedCardRow[] | null) ?? []) {
      nameByCardId.set(r.id, r.name);
    }
  }

  //  Step 4 — walk priceRows in order, dedupe to identity. First
  //  occurrence wins → max for desc, min for asc.
  const seenIdentity = new Set<string>();
  const ranked: RankedIdentity[] = [];
  for (const r of priceRows) {
    const cardId = cardIdByPrintingId.get(r.tcg_printing_id);
    if (!cardId) continue;
    const name = nameByCardId.get(cardId);
    if (!name) continue;
    const identityKey = name.toLowerCase();
    if (seenIdentity.has(identityKey)) continue;
    seenIdentity.add(identityKey);
    ranked.push({
      identityKey,
      representativeCardId: cardId,
      price: r.price,
    });
  }
  return ranked;
}

//  Cache aggressively — the ranking only shifts when a price ingest
//  completes (which invalidates the ygo:market tag).
export const rankIdentitiesByPrice = withCacheBypass(
  _rankIdentitiesByPrice,
  unstable_cache(
    _rankIdentitiesByPrice,
    ['ygo:priceRanking', 'v1'],
    { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
  ),
);

//  Currency helper. USD → tcgplayer, EUR → cardmarket. Any other
//  currency currently maps to USD; a future non-USD/EUR extension
//  would need its own branch.
export function priceSortSourceFor(currency: PriceRankCurrency): PriceRankSource {
  return currency === 'EUR' ? 'tcggraph.cardmarket' : 'tcggraph.tcgplayer';
}

// The supabase parameter is exported for callers who want to reuse a
// specific client instance; unused today because rankIdentitiesByPrice
// pulls its own client via getYugiohClient(). Kept so the signature
// evolves cleanly.
export type { SupabaseClient };
