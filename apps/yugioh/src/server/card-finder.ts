// Card Finder — identity-first, deterministically paginated.
//
// One result = one CARD IDENTITY (gameplay identity), not a
// per-printing row. The shared tcg_cards table is per-(name × rarity
// × set) so a bare search for "Blue-Eyes" returns ~2000 printings
// belonging to ~19 distinct identities. We fold those into 19
// results.
//
// Identity key. `english_id` is present in the schema but empty in
// production (0/38435 populated). `tcggraph_card_id` is 1:1 with
// tcg_cards.id and is not a shared identity. `name` is the only
// working identity signal — 14,011 distinct names cover the whole
// 38,435-row catalogue, matching the sitemap card count exactly. We
// use `LOWER(name)` as the identity key. Same-name collisions
// between genuinely different cards are extremely rare in YGO; we
// treat them as one identity since the /card/[slug] router already
// merges them.
//
// Pagination is GLOBAL. We fetch every matching row's identity-
// cheap columns, dedupe to identities, sort at the identity level,
// then slice to the current page. Only the current page's cards get
// full image + printing + price hydration. This costs a single
// paged-scan pass through the matched rows regardless of which page
// the user is on — a hit that's O(matches) rather than O(matches ×
// pages).
//
// Price filter and price sort. These need every candidate
// identity's price. Two regimes:
//   - Candidate set ≤ IDENTITY_PRICE_CAP (3000): fetch the current
//     retail across every representative printing (batched at 200
//     IDs per query, ≤ 15 round-trips). Sort/filter globally.
//   - Candidate set > IDENTITY_PRICE_CAP: refuse price sort / filter
//     and surface a friendly "add a filter" note. Never silently
//     apply a partial price sort.
//
// Attribution invariant preserved: only retail is queried for price
// (retail is printing-scoped by nature). Graded + card-scoped never
// touched here.

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

export const PAGE_SIZE = 48;

// How many candidate rows we're willing to page-scan from Postgres
// before giving up. Base ygo has 38,435 rows total; this cap
// tolerates the full base scan and every realistic filter.
const CANDIDATE_ROW_CAP = 60_000;

// Chunk size for the identity-scan. PostgREST caps returned rows at
// 1000 by default; a chunk of 1000 keeps the request count minimal.
const SCAN_CHUNK = 1000;

// Ceiling on the identity count for which we're willing to price-
// enrich globally (needed for price filter or price sort). Anything
// above this is a friendly "add a filter" refusal — we never silently
// truncate.
const IDENTITY_PRICE_CAP = 2000;

// Cap on the .in() list size when batch-fetching printings/quotes.
// 100 keeps the PostgREST URL length safely under 16KB even for
// full-length YGO id strings ("ygo:card:ygo_lob_001") and keeps the
// resulting Postgres join fast against tcg_printings.
const IN_BATCH = 100;

// ── Public shapes ────────────────────────────────────────────────

export interface FinderResultItem {
  // Card identity: one row per distinct card name.
  identityKey: string;
  card: TcgCard;
  set: TcgSet | null;
  representativePrinting: TcgPrinting | null;
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
  // Number of tcg_cards rows sharing this identity (informational).
  variantCount: number;
}

export type PriceCapability =
  | 'ok'                 // price filter/sort was applied globally
  | 'refused-large'      // set > IDENTITY_PRICE_CAP; refused
  | 'not-requested';     // no price filter/sort involved

export interface FinderResult {
  items: FinderResultItem[];
  // Distinct identity count matching the current filter set (after
  // any global price filter). This is what the traversable pagination
  // covers — page * PAGE_SIZE <= totalIdentities.
  totalIdentities: number;
  // Raw tcg_cards row count matching the same filters, for context
  // and honest reporting ("14 identities across 43 printings").
  totalRawRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: FinderSort;
  priceCapability: PriceCapability;
  // True when Postgres row count exceeds CANDIDATE_ROW_CAP and we
  // capped the identity scan.
  truncated: boolean;
  timings: {
    totalMs: number;
    candidateScanMs: number;
    priceMs: number;
    hydrateMs: number;
  };
}

// ── Query composition ──────────────────────────────────────────

type IdentityCandidate = {
  identityKey: string;
  representativeCardId: string;
  name: string;
  variantCount: number;
  // Cheap fields we can rank by without hydrating the full card row.
  atk: number | null;
  def: number | null;
  setId: string;
};

// Scan + global-price step. Split from the per-page hydration so
// pagination across a single filter set shares the same underlying
// candidate list. The cache key is derived from `filters` MINUS the
// `page` field, so page 1, 2, N all hit the same cache entry.
interface ScanBundle {
  identities: IdentityCandidate[];
  totalRawRows: number;
  truncated: boolean;
  priceCapability: PriceCapability;
  pricesUsd: Map<string, RetailQuote | null>;
  pricesEur: Map<string, RetailQuote | null>;
  candidateScanMs: number;
  priceMs: number;
  sort: FinderSort;
}

// unstable_cache serialises Map values poorly (turns them into
// {}); we round-trip Maps as arrays of [k,v] tuples so the cached
// value survives.
interface SerialisedScanBundle
  extends Omit<ScanBundle, 'pricesUsd' | 'pricesEur'> {
  pricesUsd: [string, RetailQuote | null][];
  pricesEur: [string, RetailQuote | null][];
}

function serialise(b: ScanBundle): SerialisedScanBundle {
  return {
    ...b,
    pricesUsd: [...b.pricesUsd.entries()],
    pricesEur: [...b.pricesEur.entries()],
  };
}

function deserialise(s: SerialisedScanBundle): ScanBundle {
  return {
    ...s,
    pricesUsd: new Map(s.pricesUsd),
    pricesEur: new Map(s.pricesEur),
  };
}

async function _runFinderScan(
  filtersJson: string,
): Promise<SerialisedScanBundle> {
  const filters = JSON.parse(filtersJson) as FinderFilters;
  const sort = defaultSort(filters);
  const supabase = getYugiohClient();

  let setIdFilter: string[] | null = null;
  if (filters.setCode) {
    const { data: setRows } = await supabase
      .from('tcg_sets')
      .select('id')
      .eq('game_id', YGO_GAME_ID)
      .ilike('code', filters.setCode);
    setIdFilter = ((setRows as { id: string }[] | null) ?? []).map((s) => s.id);
    if (setIdFilter.length === 0) {
      return serialise({
        identities: [],
        totalRawRows: 0,
        truncated: false,
        priceCapability: 'not-requested',
        pricesUsd: new Map(),
        pricesEur: new Map(),
        candidateScanMs: 0,
        priceMs: 0,
        sort,
      });
    }
  }

  const candidateStart = Date.now();
  const scan = await scanIdentities(supabase, filters, setIdFilter);
  const candidateScanMs = Date.now() - candidateStart;

  let identities = scan.identities.slice().sort((a, b) =>
    a.identityKey === b.identityKey
      ? a.representativeCardId.localeCompare(b.representativeCardId)
      : a.identityKey.localeCompare(b.identityKey),
  );

  const usingPriceFilter =
    filters.priceMin != null || filters.priceMax != null;
  const usingPriceSort = sort === 'price-asc' || sort === 'price-desc';
  const wantsGlobalPrice = usingPriceFilter || usingPriceSort;

  let priceCapability: PriceCapability = 'not-requested';
  let pricesUsd = new Map<string, RetailQuote | null>();
  let pricesEur = new Map<string, RetailQuote | null>();
  let priceMs = 0;

  if (wantsGlobalPrice) {
    if (identities.length > IDENTITY_PRICE_CAP) {
      priceCapability = 'refused-large';
    } else {
      priceCapability = 'ok';
      const priceStart = Date.now();
      const priced = await priceEveryIdentity(supabase, identities);
      pricesUsd = priced.pricesUsd;
      pricesEur = priced.pricesEur;
      priceMs = Date.now() - priceStart;

      if (filters.priceMin != null || filters.priceMax != null) {
        identities = identities.filter((id) => {
          const p = pricesUsd.get(id.representativeCardId)?.price;
          if (p == null) return false;
          if (filters.priceMin != null && p < filters.priceMin) return false;
          if (filters.priceMax != null && p > filters.priceMax) return false;
          return true;
        });
      }
      if (sort === 'price-asc') {
        identities = identities.slice().sort(
          (a, b) =>
            (pricesUsd.get(a.representativeCardId)?.price ?? Infinity) -
            (pricesUsd.get(b.representativeCardId)?.price ?? Infinity),
        );
      } else if (sort === 'price-desc') {
        identities = identities.slice().sort(
          (a, b) =>
            (pricesUsd.get(b.representativeCardId)?.price ?? -Infinity) -
            (pricesUsd.get(a.representativeCardId)?.price ?? -Infinity),
        );
      }
    }
  }

  identities = sortIdentities(identities, sort, filters);

  return serialise({
    identities,
    totalRawRows: scan.totalRawRows,
    truncated: scan.truncated,
    priceCapability,
    pricesUsd,
    pricesEur,
    candidateScanMs,
    priceMs,
    sort,
  });
}

const _cachedScan = unstable_cache(
  _runFinderScan,
  ['ygo:cardFinderScan', 'v2-identity'],
  { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
);

const cachedScan = withCacheBypass(_runFinderScan, _cachedScan);

// Public entry. `filters.page` is stripped from the cache key so
// paginating through one filter set shares the scan cache. Per-page
// hydration (full card rows, printings, current retail for the 48
// cards on the page) runs uncached — cheap enough that repeat page
// visits are still fast.
async function _runFinder(filtersJson: string): Promise<FinderResult> {
  const filters = JSON.parse(filtersJson) as FinderFilters;
  const sort = defaultSort(filters);
  const page = Math.max(1, filters.page ?? 1);
  const started = Date.now();

  const cacheKeyFilters: FinderFilters = { ...filters, page: undefined };
  const bundle = deserialise(
    await cachedScan(JSON.stringify(cacheKeyFilters)),
  );
  const supabase = getYugiohClient();
  const identities = bundle.identities;
  const totalIdentities = identities.length;
  const totalPages = Math.max(1, Math.ceil(totalIdentities / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * PAGE_SIZE;
  const pageIdentities = identities.slice(start, start + PAGE_SIZE);

  const hydrateStart = Date.now();
  const pageCardIds = pageIdentities.map((i) => i.representativeCardId);
  const [cards, printings, sets] = await Promise.all([
    fetchCardsById(supabase, pageCardIds),
    pageCardIds.length > 0
      ? getPrintingsForCards(supabase, pageCardIds)
      : Promise.resolve<TcgPrinting[]>([]),
    (async () => {
      const ids = Array.from(new Set(pageIdentities.map((i) => i.setId)));
      return ids.length > 0 ? getSetsByIds(supabase, ids) : [];
    })(),
  ]);
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }

  // If the scan step did NOT price everything (either not-requested or
  // refused-large), do a per-page price fetch so tiles still show a
  // number.
  let priceUsd = bundle.pricesUsd;
  let priceEur = bundle.pricesEur;
  if (bundle.priceCapability !== 'ok') {
    priceUsd = new Map();
    priceEur = new Map();
    const printingIds = printings.map((p) => p.id);
    const retail =
      printingIds.length > 0
        ? await getRetailQuotesForPrintings(supabase, printingIds)
        : [];
    const retailByPrintingId = new Map<string, RetailQuote[]>();
    for (const q of retail) {
      const b = retailByPrintingId.get(q.printingId) ?? [];
      b.push(q);
      retailByPrintingId.set(q.printingId, b);
    }
    for (const id of pageIdentities) {
      const pts = printingsByCardId.get(id.representativeCardId) ?? [];
      const flat = pts.flatMap((p) => retailByPrintingId.get(p.id) ?? []);
      priceUsd.set(
        id.representativeCardId,
        selectPreferredRetailQuote(flat, 'USD'),
      );
      priceEur.set(
        id.representativeCardId,
        selectPreferredRetailQuote(flat, 'EUR'),
      );
    }
  }
  const hydrateMs = Date.now() - hydrateStart;

  const items: FinderResultItem[] = pageIdentities
    .map((id) => {
      const card = cardsById.get(id.representativeCardId);
      if (!card) return null;
      return {
        identityKey: id.identityKey,
        card,
        set: setsById.get(card.set_id) ?? null,
        representativePrinting:
          printingsByCardId.get(card.id)?.[0] ?? null,
        bestUsdRetail: priceUsd.get(card.id) ?? null,
        bestEurRetail: priceEur.get(card.id) ?? null,
        variantCount: id.variantCount,
      };
    })
    .filter((x): x is FinderResultItem => x !== null);

  return {
    items,
    totalIdentities,
    totalRawRows: bundle.totalRawRows,
    page: clampedPage,
    pageSize: PAGE_SIZE,
    totalPages,
    sort,
    priceCapability: bundle.priceCapability,
    truncated: bundle.truncated,
    timings: {
      totalMs: Date.now() - started,
      candidateScanMs: bundle.candidateScanMs,
      priceMs: bundle.priceMs,
      hydrateMs,
    },
  };
}

// ── Scan: paged fetch of matching rows → identity list ────────────

async function scanIdentities(
  supabase: ReturnType<typeof getYugiohClient>,
  filters: FinderFilters,
  setIdFilter: string[] | null,
): Promise<{
  identities: IdentityCandidate[];
  totalRawRows: number;
  truncated: boolean;
}> {
  // Fetch only the columns we need to build identities + sort by
  // non-price dims. Small projection keeps the transfer under a
  // couple of MB even for the full 38k base scan.
  const projection =
    'id, name, set_id, gamedata';

  const byName = new Map<string, IdentityCandidate>();
  let totalRawRows = 0;
  let truncated = false;

  // We never ask Postgres for count('exact'). On the base ygo query
  // (~38k rows) COUNT(*) with JSONB predicates blows past Supabase's
  // statement-timeout. Instead we compute totalRawRows as the sum of
  // returned chunks — exact when the scan exhausts within the cap,
  // and "≥ cap" (truncated=true) when it doesn't.
  for (let from = 0; from < CANDIDATE_ROW_CAP; from += SCAN_CHUNK) {
    const to = from + SCAN_CHUNK - 1;
    let q = applyStructuredFilters(
      supabase.from('tcg_cards').select(projection),
      filters,
      setIdFilter,
    );
    // Order by `name` — indexed (~60ms/chunk against 38k rows).
    // Ordering by `id` triggered Supabase's statement_timeout: the
    // id column has no usable btree for the JSONB-filtered query
    // plan. Ordering by name is both fast and the natural sort for
    // identity dedupe below (same-name rows arrive adjacent).
    q = q.range(from, to).order('name', { ascending: true });
    const { data, error } = await q;
    if (error) {
      throw new Error(`[yugioh/card-finder] scan: ${error.message}`);
    }
    const rows =
      (data as {
        id: string;
        name: string;
        set_id: string;
        gamedata: Record<string, unknown> | null;
      }[] | null) ?? [];
    if (rows.length === 0) break;
    totalRawRows += rows.length;
    for (const r of rows) {
      const gd = r.gamedata ?? {};
      const identityKey = r.name.toLowerCase();
      const existing = byName.get(identityKey);
      if (existing) {
        existing.variantCount += 1;
        continue;
      }
      const atk = typeof gd['atk'] === 'number' ? (gd['atk'] as number) : null;
      const def = typeof gd['def'] === 'number' ? (gd['def'] as number) : null;
      byName.set(identityKey, {
        identityKey,
        representativeCardId: r.id,
        name: r.name,
        variantCount: 1,
        atk,
        def,
        setId: r.set_id,
      });
    }
    if (rows.length < SCAN_CHUNK) break;
    if (from + SCAN_CHUNK >= CANDIDATE_ROW_CAP) {
      truncated = true;
      break;
    }
  }

  return {
    identities: [...byName.values()],
    totalRawRows,
    truncated,
  };
}

// Query type is intentionally `any`. The supabase-js Filter/Builder
// chain has a deeply-nested generic signature that TypeScript cannot
// infer through a helper without hitting instantiation limits; the
// runtime interface is small and stable enough that we accept the
// loss of static typing here.
/* eslint-disable @typescript-eslint/no-explicit-any */
function applyStructuredFilters(
  query: any,
  filters: FinderFilters,
  setIdFilter: string[] | null,
): any {
/* eslint-enable @typescript-eslint/no-explicit-any */
  let q = query.eq('game_id', YGO_GAME_ID);
  if (filters.q) q = q.ilike('name', `%${escapeIlike(filters.q)}%`);
  if (filters.attribute)
    q = q.filter('gamedata->>attribute', 'eq', filters.attribute);
  if (filters.frameType)
    q = q.filter('gamedata->>frameType', 'eq', filters.frameType);
  if (filters.race) q = q.filter('gamedata->>race', 'eq', filters.race);
  if (filters.rarity) q = q.eq('rarity', filters.rarity);
  if (filters.level != null)
    q = q.filter('gamedata->>level', 'eq', String(filters.level));
  if (filters.rank != null)
    q = q.filter('gamedata->>rank', 'eq', String(filters.rank));
  if (filters.linkRating != null)
    q = q.filter('gamedata->>linkRating', 'eq', String(filters.linkRating));
  if (filters.atkMin != null)
    q = q.filter('gamedata->atk', 'gte', String(filters.atkMin));
  if (filters.atkMax != null)
    q = q.filter('gamedata->atk', 'lte', String(filters.atkMax));
  if (filters.defMin != null)
    q = q.filter('gamedata->def', 'gte', String(filters.defMin));
  if (filters.defMax != null)
    q = q.filter('gamedata->def', 'lte', String(filters.defMax));
  if (filters.banlistTcg)
    q = q.filter('gamedata->banlist->>tcg', 'eq', filters.banlistTcg);
  if (filters.archetype)
    q = q.filter(
      'gamedata->archetypes',
      'cs',
      JSON.stringify([filters.archetype]),
    );
  if (setIdFilter) q = q.in('set_id', setIdFilter);
  return q;
}

// ── Identity-level sort (non-price) ───────────────────────────────

function sortIdentities(
  identities: IdentityCandidate[],
  sort: FinderSort,
  filters: FinderFilters,
): IdentityCandidate[] {
  const needle = filters.q ? filters.q.toLowerCase() : '';
  switch (sort) {
    case 'name-asc':
      return [...identities].sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return [...identities].sort((a, b) => b.name.localeCompare(a.name));
    case 'atk-desc':
      return [...identities].sort(
        (a, b) => (b.atk ?? -Infinity) - (a.atk ?? -Infinity),
      );
    case 'atk-asc':
      return [...identities].sort(
        (a, b) => (a.atk ?? Infinity) - (b.atk ?? Infinity),
      );
    case 'def-desc':
      return [...identities].sort(
        (a, b) => (b.def ?? -Infinity) - (a.def ?? -Infinity),
      );
    case 'newest':
    case 'oldest': {
      // Sort by representative set_id then re-order by release-date
      // after the set fetch for the CURRENT page. This keeps global
      // pagination stable across visits — new sets shift the order
      // only when a release lands.
      return [...identities].sort((a, b) => {
        const cmp = b.setId.localeCompare(a.setId);
        return sort === 'newest' ? cmp : -cmp;
      });
    }
    case 'relevance':
      // Name-match relevance: exact first, then starts-with, then
      // alphabetical.
      if (!needle) return identities;
      return [...identities].sort((a, b) => {
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
    default:
      // Price sorts are handled by the price-enrichment step; here
      // we just keep the identities in their scan order (name asc).
      return identities;
  }
}

// ── Full-catalogue price enrichment (for price filter / sort) ─────

async function priceEveryIdentity(
  supabase: ReturnType<typeof getYugiohClient>,
  identities: readonly IdentityCandidate[],
): Promise<{
  pricesUsd: Map<string, RetailQuote | null>;
  pricesEur: Map<string, RetailQuote | null>;
}> {
  const cardIds = identities.map((i) => i.representativeCardId);
  const printings: TcgPrinting[] = [];
  // Batch the printings-for-cards lookup. getPrintingsForCards
  // already handles its own paging when the ID list is <= ~500;
  // we batch further at IN_BATCH for URL length safety.
  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const batch = cardIds.slice(i, i + IN_BATCH);
    const rows = await getPrintingsForCards(supabase, batch);
    printings.push(...rows);
  }
  const printingIds = printings.map((p) => p.id);
  const quotes: RetailQuote[] = [];
  for (let i = 0; i < printingIds.length; i += IN_BATCH) {
    const batch = printingIds.slice(i, i + IN_BATCH);
    const rows = await getRetailQuotesForPrintings(supabase, batch);
    quotes.push(...rows);
  }
  const quotesByPrintingId = new Map<string, RetailQuote[]>();
  for (const q of quotes) {
    const b = quotesByPrintingId.get(q.printingId) ?? [];
    b.push(q);
    quotesByPrintingId.set(q.printingId, b);
  }
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const b = printingsByCardId.get(p.tcg_card_id) ?? [];
    b.push(p);
    printingsByCardId.set(p.tcg_card_id, b);
  }
  const pricesUsd = new Map<string, RetailQuote | null>();
  const pricesEur = new Map<string, RetailQuote | null>();
  for (const id of identities) {
    const pts = printingsByCardId.get(id.representativeCardId) ?? [];
    const flat = pts.flatMap((p) => quotesByPrintingId.get(p.id) ?? []);
    pricesUsd.set(
      id.representativeCardId,
      selectPreferredRetailQuote(flat, 'USD'),
    );
    pricesEur.set(
      id.representativeCardId,
      selectPreferredRetailQuote(flat, 'EUR'),
    );
  }
  return { pricesUsd, pricesEur };
}

// ── Small helpers ────────────────────────────────────────────────

async function fetchCardsById(
  supabase: ReturnType<typeof getYugiohClient>,
  cardIds: readonly string[],
): Promise<TcgCard[]> {
  if (cardIds.length === 0) return [];
  const out: TcgCard[] = [];
  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const batch = cardIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', batch as string[]);
    if (error) {
      throw new Error(
        `[yugioh/card-finder] hydrate cards: ${error.message}`,
      );
    }
    out.push(...((data as TcgCard[] | null) ?? []));
  }
  return out;
}

function emptyResult(
  sort: FinderSort,
  page: number,
  started: number,
): FinderResult {
  return {
    items: [],
    totalIdentities: 0,
    totalRawRows: 0,
    page,
    pageSize: PAGE_SIZE,
    totalPages: 0,
    sort,
    priceCapability: 'not-requested',
    truncated: false,
    timings: { totalMs: Date.now() - started, candidateScanMs: 0, priceMs: 0, hydrateMs: 0 },
  };
}

function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, (m) => `\\${m}`);
}

// ── Cached wrapper ───────────────────────────────────────────────

const _cachedRunFinder = unstable_cache(
  _runFinder,
  ['ygo:cardFinder', 'v2-identity'],
  { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
);

const cachedRunFinder = withCacheBypass(_runFinder, _cachedRunFinder);

// Public entry. Strips `page` from the cache key so paginating
// through a single filter set does not re-scan the candidate list
// for every page — a scan pass is O(matches) and we can amortise it
// across every page under the same filter set. The full result
// object still has to be materialised per page since the current
// page's hydration is baked in; TODO for a future pass: split the
// cache further so hydration alone is per-page.
export async function runYugiohCardFinder(
  filters: FinderFilters,
): Promise<FinderResult> {
  return cachedRunFinder(JSON.stringify(filters));
}
