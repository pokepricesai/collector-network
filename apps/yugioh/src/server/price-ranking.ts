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
// This module flips the direction and pushes the whole join + dedupe
// into Postgres via the `yugioh_rank_identities_by_price` RPC (see
// supabase/migrations/20260930010000_ygo_price_rank_rpc.sql). One
// indexed query per 1000-row page; ~14 pages cover the full YGO
// catalogue in ~10s cold. Cached under MARKET_SHORT so prewarm keeps
// user traffic warm.
//
// Semantics:
//   * game_id = 'ygo' (fixed inside the SQL)
//   * source = tcggraph.tcgplayer | tcggraph.cardmarket
//   * currency = USD | EUR
//   * direction = 'desc' (highest price of any printing wins) |
//                 'asc'  (lowest price of any printing wins)
//   * Identity = lowercase card name
//   * Result is ordered by best price in the requested direction
//   * Ties broken by name asc, then by printing id (deterministic)

const RANK_RPC = 'yugioh_rank_identities_by_price';
// PostgREST caps a single RPC response at 1000 rows, so we page.
const RANK_PAGE = 1000;
// Absolute cap on identities we return. YGO has ~14k logical
// identities; 20k is comfortable headroom without letting a runaway
// query drag on forever.
const RANK_TOTAL_CAP = 20_000;

export type PriceRankSource = 'tcggraph.tcgplayer' | 'tcggraph.cardmarket';
export type PriceRankCurrency = 'USD' | 'EUR';
export type PriceRankDirection = 'asc' | 'desc';

export interface RankedIdentity {
  identityKey: string;           // lowercase(name)
  representativeCardId: string;  // tcg_cards.id used for hydration
  price: number;                 // best price for this identity in the ranked direction
}

interface RpcRow {
  card_id: string;
  name: string;
  price: number;
}

async function _rankIdentitiesByPrice(
  source: PriceRankSource,
  currency: PriceRankCurrency,
  direction: PriceRankDirection,
): Promise<RankedIdentity[]> {
  const supabase = getYugiohClient();
  const out: RankedIdentity[] = [];
  for (let off = 0; off < RANK_TOTAL_CAP; off += RANK_PAGE) {
    const { data, error } = await supabase
      .rpc(RANK_RPC, {
        p_source: source,
        p_currency: currency,
        p_direction: direction,
      })
      .range(off, off + RANK_PAGE - 1);
    if (error) {
      throw new Error(
        `[yugioh/price-ranking] ${RANK_RPC}(${source},${currency},${direction}) offset ${off}: ${error.message}`,
      );
    }
    const rows = (data as RpcRow[] | null) ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!r.name || r.price == null || !Number.isFinite(r.price)) continue;
      out.push({
        identityKey: r.name.toLowerCase(),
        representativeCardId: r.card_id,
        price: Number(r.price),
      });
    }
    if (rows.length < RANK_PAGE) break;
  }
  return out;
}

//  Cache aggressively — the ranking only shifts when a price ingest
//  completes, which invalidates the ygo:market tag from the mtgprices-
//  web ingest via /api/revalidate.
export const rankIdentitiesByPrice = withCacheBypass(
  _rankIdentitiesByPrice,
  unstable_cache(
    _rankIdentitiesByPrice,
    ['ygo:priceRanking', 'v2-rpc'],
    { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
  ),
);

//  Currency helper. USD → tcgplayer, EUR → cardmarket. Any other
//  currency currently maps to USD; a future non-USD/EUR extension
//  would need its own branch.
export function priceSortSourceFor(currency: PriceRankCurrency): PriceRankSource {
  return currency === 'EUR' ? 'tcggraph.cardmarket' : 'tcggraph.tcgplayer';
}

export type { SupabaseClient };
