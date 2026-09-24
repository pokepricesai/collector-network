// Card Finder query composition. Pushes as many filter dimensions
// as possible into Postgres (via PostgREST JSONB path filters) and
// applies only price-range filtering application-side after batching
// the current-retail lookup.
//
// Attribution rules preserved: only retail (printing-scoped by
// nature) is queried for the price filter — never graded, never
// card-scoped.

import { unstable_cache } from 'next/cache';
import {
  getPrintingsForCards,
  getSetsByIds,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
  type RetailQuote,
} from '@collector-network/market-data';
import type { FinderFilters, FinderSort } from '../lib/finder-filters';
import { defaultSort } from '../lib/finder-filters';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';

const YGO_GAME_ID = 'ygo';

// One finder page. Kept modest so a full round-trip (cards → prices
// → sets) stays well under the Slice-A market target of < 1s warm.
export const PAGE_SIZE = 48;

// Cap on how many rows we pull from Postgres before pagination.
// Postgres does the ordering; we slice to page-size in Node. This
// gives us a stable pagination surface even without a full RPC, at
// the cost of not being able to iterate past N deep matches per
// query. 500 covers virtually every realistic filter combination
// against 38k cards.
const HARD_ROW_CAP = 500;

// Extra headroom for price-range filters. We fetch HARD_ROW_CAP
// cards, load their retail, then filter — so a very tight price
// range can eat through the sample. Requesting a bigger sample only
// when price filters are active keeps common queries fast.
const HARD_ROW_CAP_WITH_PRICE = 1500;

export interface FinderResultItem {
  card: TcgCard;
  set: TcgSet | null;
  representativePrinting: TcgPrinting | null;
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
}

export interface FinderResult {
  items: FinderResultItem[];
  totalMatches: number;   // matches BEFORE price filtering (best effort)
  page: number;
  pageSize: number;
  totalPages: number;
  sort: FinderSort;
  // Signals whether we hit HARD_ROW_CAP and there might be more
  // matches Postgres could return — surfaces "narrow your filters"
  // messaging in the UI.
  truncated: boolean;
  // Recorded so verify scripts / benchmarks can compare execution
  // costs without re-running the query.
  timings: { totalMs: number; queryMs: number; priceMs: number };
}

// ── Query composition ──────────────────────────────────────────

async function _runFinder(
  filtersJson: string,
): Promise<FinderResult> {
  const filters = JSON.parse(filtersJson) as FinderFilters;
  const sort = defaultSort(filters);
  const page = Math.max(1, filters.page ?? 1);
  const usingPriceFilter =
    filters.priceMin != null || filters.priceMax != null;
  const cap = usingPriceFilter ? HARD_ROW_CAP_WITH_PRICE : HARD_ROW_CAP;
  const supabase = getYugiohClient();
  const started = Date.now();

  // Base query — everything Postgres can filter directly.
  let query = supabase
    .from('tcg_cards')
    .select('*', { count: 'exact' })
    .eq('game_id', YGO_GAME_ID);

  if (filters.q) {
    // ILIKE against name only. Effect-text search would need the
    // separate rules_text column; keeping it name-first for tight
    // latency in Slice B, extend later.
    query = query.ilike('name', `%${escapeIlike(filters.q)}%`);
  }
  if (filters.attribute) {
    query = query.filter('gamedata->>attribute', 'eq', filters.attribute);
  }
  if (filters.frameType) {
    query = query.filter('gamedata->>frameType', 'eq', filters.frameType);
  }
  if (filters.race) {
    query = query.filter('gamedata->>race', 'eq', filters.race);
  }
  if (filters.rarity) {
    query = query.eq('rarity', filters.rarity);
  }
  if (filters.setCode) {
    // Two-step: set-code → set-id. Do it in parallel later if this
    // becomes a hot path; a single ilike is cheap for now.
    const { data: setRows } = await supabase
      .from('tcg_sets')
      .select('id')
      .eq('game_id', YGO_GAME_ID)
      .ilike('code', filters.setCode);
    const ids = ((setRows as { id: string }[] | null) ?? []).map((s) => s.id);
    if (ids.length === 0) {
      return emptyResult(filters, sort, page, started);
    }
    query = query.in('set_id', ids);
  }
  if (filters.level != null) {
    // Numeric JSONB filter — PostgREST casts using ::int automatically
    // when the operator is a numeric comparison; keep it as text eq
    // for portability. Level is a small enum so eq is fine.
    query = query.filter('gamedata->>level', 'eq', String(filters.level));
  }
  if (filters.rank != null) {
    query = query.filter('gamedata->>rank', 'eq', String(filters.rank));
  }
  if (filters.linkRating != null) {
    query = query.filter('gamedata->>linkRating', 'eq', String(filters.linkRating));
  }
  if (filters.atkMin != null) {
    // JSONB numeric comparisons need `->` (not `->>`) and gte.
    query = query.filter('gamedata->atk', 'gte', String(filters.atkMin));
  }
  if (filters.atkMax != null) {
    query = query.filter('gamedata->atk', 'lte', String(filters.atkMax));
  }
  if (filters.defMin != null) {
    query = query.filter('gamedata->def', 'gte', String(filters.defMin));
  }
  if (filters.defMax != null) {
    query = query.filter('gamedata->def', 'lte', String(filters.defMax));
  }
  if (filters.banlistTcg) {
    query = query.filter('gamedata->banlist->>tcg', 'eq', filters.banlistTcg);
  }
  if (filters.archetype) {
    // Postgres JSONB `cs` (contains) on a JSON array. Compact syntax:
    // `?filter=gamedata->archetypes.cs.["Blue-Eyes"]` — the client
    // library exposes contains() but not the JSON-path variant.
    // Fall back to the raw filter operator with a stringified array
    // as the value.
    query = query.filter(
      'gamedata->archetypes',
      'cs',
      JSON.stringify([filters.archetype]),
    );
  }

  // Sort applied at the Postgres level where possible. Fallbacks
  // (relevance, price-*) are applied application-side after the
  // fetch.
  switch (sort) {
    case 'name-asc':
      query = query.order('name', { ascending: true });
      break;
    case 'name-desc':
      query = query.order('name', { ascending: false });
      break;
    case 'atk-desc':
    case 'atk-asc':
      query = query.order('gamedata->atk', { ascending: sort === 'atk-asc' });
      break;
    case 'def-desc':
      query = query.order('gamedata->def', { ascending: false });
      break;
    case 'newest':
    case 'oldest':
      // set_id has YYYY-MM-DD ordering baked in via the id scheme
      // (`ygo_lob_001` doesn't sort chronologically); we can't sort
      // by set release without joining, so fall through to name-asc
      // as a stable secondary sort and apply set-date ordering
      // application-side after the set fetch.
      query = query.order('name', { ascending: true });
      break;
    case 'relevance':
    case 'price-asc':
    case 'price-desc':
    default:
      // Relevance for name-match: keep DB in name-asc order then
      // resort exact-first application-side.
      query = query.order('name', { ascending: true });
      break;
  }

  query = query.range(0, cap - 1);

  const { data: cardRows, error, count } = await query;
  if (error) {
    throw new Error(`[yugioh/card-finder] cards query: ${error.message}`);
  }
  const queryMs = Date.now() - started;
  let cards = ((cardRows as TcgCard[] | null) ?? []);
  const totalMatches = count ?? cards.length;

  // ── Relevance re-rank (exact match first, then starts-with) ────
  if (sort === 'relevance' && filters.q) {
    const needle = filters.q.toLowerCase();
    cards = cards.slice().sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      const aExact = an === needle ? 0 : 2;
      const bExact = bn === needle ? 0 : 2;
      const aStart = an.startsWith(needle) ? 1 : 3;
      const bStart = bn.startsWith(needle) ? 1 : 3;
      const aScore = Math.min(aExact, aStart);
      const bScore = Math.min(bExact, bStart);
      return aScore === bScore ? an.localeCompare(bn) : aScore - bScore;
    });
  }

  // ── Deduplicate by card NAME ───────────────────────────────────
  // tcg_cards is per-(name × rarity × set) so a search for "Blue-
  // Eyes" naturally returns dozens of duplicate names. Present one
  // row per name — the highest-rarity example we saw first.
  const seen = new Set<string>();
  const deduped: TcgCard[] = [];
  for (const c of cards) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    deduped.push(c);
  }

  // ── Load pricing for the current page's card ids ───────────────
  // Fetch printings for the deduped cards, then batch retail
  // quotes. We only need enough rows to price the sample; when a
  // price filter is active this is used for filtering, otherwise
  // just for the display column.
  const priceStart = Date.now();
  const cardIds = deduped.map((c) => c.id);
  const [printings, setsById] = await Promise.all([
    cardIds.length > 0
      ? getPrintingsForCards(supabase, cardIds)
      : Promise.resolve<TcgPrinting[]>([]),
    (async () => {
      const setIds = Array.from(new Set(deduped.map((c) => c.set_id)));
      const sets = await getSetsByIds(supabase, setIds);
      return new Map(sets.map((s) => [s.id, s]));
    })(),
  ]);
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }
  const printingIds = printings.map((p) => p.id);
  const retail =
    printingIds.length > 0
      ? await getRetailQuotesForPrintings(supabase, printingIds)
      : [];
  const retailByPrinting = new Map<string, RetailQuote[]>();
  for (const q of retail) {
    const b = retailByPrinting.get(q.printingId) ?? [];
    b.push(q);
    retailByPrinting.set(q.printingId, b);
  }
  const priceMs = Date.now() - priceStart;

  // Build the result item for each card. representativePrinting is
  // the first printing we found for the card (deterministic given
  // the DB's natural ordering); bestUsdRetail is selected across
  // every printing of the card so a filter like "Common under $5"
  // still hits a card that's expensive in Ultra Rare form but
  // cheap in Common.
  const items: FinderResultItem[] = deduped.map((card) => {
    const cardPrintings = printingsByCardId.get(card.id) ?? [];
    const allMarket = cardPrintings.flatMap(
      (p) => retailByPrinting.get(p.id) ?? [],
    );
    return {
      card,
      set: setsById.get(card.set_id) ?? null,
      representativePrinting: cardPrintings[0] ?? null,
      bestUsdRetail: selectPreferredRetailQuote(allMarket, 'USD'),
      bestEurRetail: selectPreferredRetailQuote(allMarket, 'EUR'),
    };
  });

  // ── Apply price filter application-side ────────────────────────
  let filteredItems = items;
  if (filters.priceMin != null) {
    filteredItems = filteredItems.filter(
      (i) => (i.bestUsdRetail?.price ?? -Infinity) >= filters.priceMin!,
    );
  }
  if (filters.priceMax != null) {
    filteredItems = filteredItems.filter(
      (i) => (i.bestUsdRetail?.price ?? Infinity) <= filters.priceMax!,
    );
  }

  // Sorts that need pricing / set-date live here.
  if (sort === 'price-asc') {
    filteredItems.sort(
      (a, b) => (a.bestUsdRetail?.price ?? Infinity) - (b.bestUsdRetail?.price ?? Infinity),
    );
  } else if (sort === 'price-desc') {
    filteredItems.sort(
      (a, b) => (b.bestUsdRetail?.price ?? -Infinity) - (a.bestUsdRetail?.price ?? -Infinity),
    );
  } else if (sort === 'newest' || sort === 'oldest') {
    filteredItems.sort((a, b) => {
      const ra = a.set?.released_at ?? '';
      const rb = b.set?.released_at ?? '';
      return sort === 'newest' ? rb.localeCompare(ra) : ra.localeCompare(rb);
    });
  }

  // Slice to page.
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PAGE_SIZE;
  const pageItems = filteredItems.slice(start, start + PAGE_SIZE);

  return {
    items: pageItems,
    // Report the pre-price-filter count for the "matches" indicator
    // so users can see the raw filter breadth even when a price
    // filter clips the shown set.
    totalMatches: usingPriceFilter ? filteredItems.length : totalMatches,
    page: clampedPage,
    pageSize: PAGE_SIZE,
    totalPages,
    sort,
    truncated: (count ?? 0) > cap,
    timings: {
      totalMs: Date.now() - started,
      queryMs,
      priceMs,
    },
  };
}

function emptyResult(
  filters: FinderFilters,
  sort: FinderSort,
  page: number,
  started: number,
): FinderResult {
  return {
    items: [],
    totalMatches: 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: 0,
    sort,
    truncated: false,
    timings: { totalMs: Date.now() - started, queryMs: 0, priceMs: 0 },
  };
}

function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

// Cached wrapper. Key: JSON-stringified filters. The bypass flag
// gives scripts/audits the raw path.
const _cachedRunFinder = unstable_cache(
  _runFinder,
  ['ygo:cardFinder', 'v1'],
  { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
);

const cachedRunFinder = withCacheBypass(_runFinder, _cachedRunFinder);

export async function runYugiohCardFinder(
  filters: FinderFilters,
): Promise<FinderResult> {
  return cachedRunFinder(JSON.stringify(filters));
}
