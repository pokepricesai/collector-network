import 'server-only';
import {
  getPrintingsForCards,
  type TcgCard,
  type TcgSet,
} from '@collector-network/database';
import {
  getPrintingPricingBatch,
  type PrintingPricing,
} from '@collector-network/market-data';
import { getOnepieceClient, getOnepieceGameId } from './client';
import { toOpGamedata, type OpGamedata } from '../lib/onepiece/gamedata';
import type { OpCardType } from '../lib/onepiece/card-type';
import type { OpColour } from '../lib/onepiece/colour';
import { slugifyCardName } from '../lib/onepiece/slug';

// Real interactive card-finder query layer. Runs against live
// production data (5,538 OP cards, all with populated gamedata for
// cardType/colors/cost/power/counter/life/attribute).
//
// Design notes:
//   - JSON-key filters run in the DB via PostgREST's jsonb operators
//     so we never pull the whole catalogue into Node.
//   - "Top price" per card is computed from the joined printings +
//     market feed. If a card has no priced printing, priceEur stays
//     null; caller decides whether to show or hide unpriced cards.
//   - Sort dimensions are the ones collectors actually reach for:
//     name (A-Z default), top price desc/asc, cost asc, power desc,
//     newest set. Every URL parameter is stable and shareable.

export type OpSort =
  | 'name'
  | 'price-desc'
  | 'price-asc'
  | 'cost-asc'
  | 'power-desc'
  | 'set-newest';

export interface OpFinderFilters {
  q?: string;
  colour?: OpColour | 'multi';
  cardType?: OpCardType;
  rarity?: string;
  setId?: string;
  costMin?: number;
  costMax?: number;
  powerMin?: number;
  powerMax?: number;
  counterMin?: number;
  counterMax?: number;
  lifeMin?: number;
  lifeMax?: number;
  attribute?: string;
  priceMinEur?: number;
  priceMaxEur?: number;
  /** Skip printings for which no price observation exists. */
  onlyPriced?: boolean;
}

export interface OpFinderTile {
  cardId: string;
  name: string;
  collectorNumber: string | null;
  rarity: string | null;
  gamedata: OpGamedata;
  set: TcgSet | null;
  imageUrl: string | null;
  href: string;
  priceEur: number | null;
  printingCount: number;
}

export interface OpFinderResult {
  tiles: OpFinderTile[];
  total: number;
  pageSize: number;
  page: number;
}

// PostgREST column expression for a jsonb key.  Because Supabase JS
// wants dotted paths like `gamedata->cardType`, we spell those out
// per filter branch.

export async function queryFinder(
  filters: OpFinderFilters,
  sort: OpSort,
  page: number,
  pageSize: number,
  sets: TcgSet[],
): Promise<OpFinderResult> {
  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);

  // Supabase's PostgREST caps a single `.select()` at 1000 rows by
  // default. The full OP catalogue is 5,538 cards, so a naive
  // single-shot fetch would only see the first alphabetical slice.
  // We page through with parallel `.range()` calls covering the full
  // window and apply the same filter chain to every chunk.
  const CHUNK_SIZE = 1000;
  const CHUNKS = 6; // 6 × 1000 = 6000 rows, comfortably above the 5,538 catalogue size

  // Numeric range filters over jsonb are applied in Node so the
  // Supabase query stays simple. Cheap: OP catalogue is 5.5k rows.
  //
  // Fetch every chunk in parallel. The `.range(a, b)` bound is
  // inclusive so [0, 999], [1000, 1999], … cover 6000 rows total.
  const chunkFetches = Array.from({ length: CHUNKS }, async (_, i) => {
    const from = i * CHUNK_SIZE;
    const to = from + CHUNK_SIZE - 1;
    // Rebuild the query fresh per chunk — Supabase builders are
    // stateful, so re-issuing the same `q` would drop range()
    // between calls. We reconstruct with the exact same filter chain.
    let chunk = supabase
      .from('tcg_cards')
      .select('id,name,collector_number,rarity,set_id,images,gamedata')
      .eq('game_id', gameId)
      .order('name', { ascending: true });
    if (filters.q && filters.q.trim().length >= 2) chunk = chunk.ilike('name', `%${filters.q.trim()}%`);
    if (filters.setId) chunk = chunk.eq('set_id', filters.setId);
    if (filters.rarity) chunk = chunk.eq('rarity', filters.rarity.toUpperCase());
    if (filters.cardType) chunk = chunk.eq('gamedata->>cardType', filters.cardType.toUpperCase());
    if (filters.attribute) chunk = chunk.eq('gamedata->>attribute', filters.attribute);
    if (filters.colour && filters.colour !== 'multi') {
      const cap = filters.colour.charAt(0).toUpperCase() + filters.colour.slice(1);
      chunk = chunk.filter('gamedata->colors', 'cs', `["${cap}"]`);
    } else if (filters.colour === 'multi') {
      chunk = chunk.not('gamedata->colors->1', 'is', null);
    }
    return chunk.range(from, to);
  });

  const chunkResults = await Promise.all(chunkFetches);
  const rawCards: TcgCard[] = [];
  for (const { data, error } of chunkResults) {
    if (error) {
      throw new Error(`[finder] queryFinder tcg_cards chunk: ${error.message}`);
    }
    if (data) rawCards.push(...(data as TcgCard[]));
  }

  // Post-filter numeric ranges in Node so the query API stays
  // simple. This narrows the candidate window before the price
  // join.
  const filtered = rawCards.filter((c) => {
    const g = toOpGamedata(c.gamedata);
    if (filters.costMin != null && (g.cost == null || g.cost < filters.costMin)) return false;
    if (filters.costMax != null && (g.cost == null || g.cost > filters.costMax)) return false;
    if (filters.powerMin != null && (g.power == null || g.power < filters.powerMin)) return false;
    if (filters.powerMax != null && (g.power == null || g.power > filters.powerMax)) return false;
    if (filters.counterMin != null && (g.counter == null || g.counter < filters.counterMin)) return false;
    if (filters.counterMax != null && (g.counter == null || g.counter > filters.counterMax)) return false;
    if (filters.lifeMin != null && (g.life == null || g.life < filters.lifeMin)) return false;
    if (filters.lifeMax != null && (g.life == null || g.life > filters.lifeMax)) return false;
    return true;
  });

  // Deduplicate to logical cards (one entry per name) so parallels
  // of the same card don't flood the finder. Prefer the highest-
  // rarity row so the surfaced tile carries the chase price.
  const rarityRank: Record<string, number> = {
    TR: 8, SEC: 7, 'SP CARD': 6, SR: 5, L: 4, R: 3, UC: 2, C: 1, P: 3,
  };
  const byName = new Map<string, TcgCard[]>();
  for (const c of filtered) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const dedupedAnchors: TcgCard[] = [];
  for (const bucket of byName.values()) {
    const sorted = [...bucket].sort((a, b) =>
      (rarityRank[(b.rarity ?? '').toUpperCase()] ?? 0) -
      (rarityRank[(a.rarity ?? '').toUpperCase()] ?? 0));
    dedupedAnchors.push(sorted[0]!);
  }

  // Pricing is expensive: 1,384 unique cards × ~2-3 printings each
  // → up to ~4,000 rows in the pricing lookup. We split the flow into
  // "needs full pricing to rank" vs "only needs pricing for the
  // visible page" so the default no-filter render stays fast.
  const needsFullPricing =
    sort === 'price-desc' || sort === 'price-asc' ||
    filters.onlyPriced === true ||
    filters.priceMinEur != null || filters.priceMaxEur != null;

  // For price-based ranking we cap the candidate set so the pricing
  // join stays bounded and — importantly — so the `IN (…)` list on
  // the printings lookup fits inside PostgREST's URL length limit
  // (~2 KB → roughly 400 UUIDs). Priced cards skew heavily to
  // Leaders and chase treatments, so 300 unique names is enough to
  // surface the true top of the market for OP's current catalogue.
  const anchorsForPricing = needsFullPricing
    ? dedupedAnchors.slice(0, 300)
    : dedupedAnchors;

  const setsById = new Map(sets.map((s) => [s.id, s]));

  // Pricing across ALL cards sharing a name (parallels, reprints,
  // secret-rare variants) — never just the anchor's own printings.
  // Otherwise a logical card would price at its base row and miss the
  // Parallel's premium.
  async function loadPricing(anchors: TcgCard[]): Promise<{
    topByCard: Map<string, number>;
    printingsByCard: Map<string, string[]>;
  }> {
    if (anchors.length === 0) return { topByCard: new Map(), printingsByCard: new Map() };
    const anchorIds = new Set(anchors.map((c) => c.id));
    const anchorNames = new Set(anchors.map((c) => c.name));
    // Collect every card row that shares a name with one of our anchors.
    const relatedCardIds = new Set<string>();
    for (const [name, bucket] of byName.entries()) {
      if (!anchorNames.has(name)) continue;
      for (const c of bucket) relatedCardIds.add(c.id);
    }
    const allRelatedIds = [...relatedCardIds];
    // Chunk the .in(…) lookup to stay well inside PostgREST's URL
    // length limit — a full-catalogue colour filter can push 1,000+
    // related IDs, which crashes a single .in() call.
    const PRINTING_LOOKUP_CHUNK = 200;
    const printings: Awaited<ReturnType<typeof getPrintingsForCards>> = [];
    for (let i = 0; i < allRelatedIds.length; i += PRINTING_LOOKUP_CHUNK) {
      const slice = allRelatedIds.slice(i, i + PRINTING_LOOKUP_CHUNK);
      const rows = await getPrintingsForCards(supabase, slice);
      printings.push(...rows);
    }
    // printingsByCard remains anchor-scoped for the tile "N printings"
    // count so the number matches what the user sees on the anchor
    // (highest-rarity) treatment.
    const printingsByCard = new Map<string, string[]>();
    const printingsByName = new Map<string, string[]>();
    // Build a card_id → name lookup for the price aggregation.
    const cardIdToName = new Map<string, string>();
    for (const [name, bucket] of byName.entries()) {
      for (const c of bucket) cardIdToName.set(c.id, name);
    }
    for (const p of printings) {
      if (anchorIds.has(p.tcg_card_id)) {
        const bucket = printingsByCard.get(p.tcg_card_id);
        if (bucket) bucket.push(p.id);
        else printingsByCard.set(p.tcg_card_id, [p.id]);
      }
      const name = cardIdToName.get(p.tcg_card_id);
      if (name) {
        const bucket = printingsByName.get(name);
        if (bucket) bucket.push(p.id);
        else printingsByName.set(name, [p.id]);
      }
    }
    const allPrintingIds = printings.map((p) => p.id);
    // Same URL length concern applies to the pricing lookup — the
    // shared helper uses .in(...) with the full list.
    const PRICING_CHUNK = 200;
    const pricingMap = new Map<string, PrintingPricing>();
    for (let i = 0; i < allPrintingIds.length; i += PRICING_CHUNK) {
      const slice = allPrintingIds.slice(i, i + PRICING_CHUNK);
      const partial = await getPrintingPricingBatch(supabase, slice);
      for (const [k, v] of partial.entries()) pricingMap.set(k, v);
    }
    // Aggregate the max EUR price seen across every printing that
    // shares the anchor's name — surfaces the Parallel premium.
    const topByName = new Map<string, number>();
    for (const [name, printingIds] of printingsByName.entries()) {
      let best: number | null = null;
      for (const printingId of printingIds) {
        const pricing = pricingMap.get(printingId);
        if (!pricing) continue;
        for (const row of pricing.market ?? []) {
          if (row.price == null || !row.currency) continue;
          if (row.currency !== 'EUR') continue;
          if (best == null || row.price > best) best = row.price;
        }
      }
      if (best != null) topByName.set(name, best);
    }
    // Re-key back to card_id for the caller: each anchor gets the
    // name-scoped max.
    const topByCard = new Map<string, number>();
    for (const anchor of anchors) {
      const p = topByName.get(anchor.name);
      if (p != null) topByCard.set(anchor.id, p);
    }
    return { topByCard, printingsByCard };
  }

  function materialise(anchor: TcgCard, priceEur: number | null, printingCount: number): OpFinderTile {
    const gamedata = toOpGamedata(anchor.gamedata);
    return {
      cardId: anchor.id,
      name: anchor.name,
      collectorNumber: anchor.collector_number,
      rarity: anchor.rarity,
      gamedata,
      set: setsById.get(anchor.set_id) ?? null,
      imageUrl: pickImage(anchor.images),
      href: `/card/${slugifyCardName(anchor.name)}`,
      priceEur,
      printingCount,
    };
  }

  if (needsFullPricing) {
    const { topByCard, printingsByCard } = await loadPricing(anchorsForPricing);
    const tiles = anchorsForPricing.map((a) =>
      materialise(a, topByCard.get(a.id) ?? null, printingsByCard.get(a.id)?.length ?? 0),
    );
    const filteredByPrice = tiles.filter((t) => {
      if (filters.onlyPriced && t.priceEur == null) return false;
      if (filters.priceMinEur != null && (t.priceEur == null || t.priceEur < filters.priceMinEur)) return false;
      if (filters.priceMaxEur != null && (t.priceEur == null || t.priceEur > filters.priceMaxEur)) return false;
      return true;
    });
    filteredByPrice.sort((a, b) => compareTiles(a, b, sort));
    const total = filteredByPrice.length;
    const start = page * pageSize;
    return {
      tiles: filteredByPrice.slice(start, start + pageSize),
      total,
      pageSize,
      page,
    };
  }

  // Deferred-pricing branch: sort what we can without price, slice to
  // the visible page, then fetch pricing only for that page.
  const untilPricedTiles = dedupedAnchors.map((a) => materialise(a, null, 0));
  untilPricedTiles.sort((a, b) => compareTiles(a, b, sort));
  const total = untilPricedTiles.length;
  const start = page * pageSize;
  const pageWindow = untilPricedTiles.slice(start, start + pageSize);
  const pageAnchors = pageWindow
    .map((t) => dedupedAnchors.find((a) => a.id === t.cardId))
    .filter((a): a is TcgCard => Boolean(a));
  const { topByCard, printingsByCard } = await loadPricing(pageAnchors);
  const tiles = pageAnchors.map((a) =>
    materialise(a, topByCard.get(a.id) ?? null, printingsByCard.get(a.id)?.length ?? 0),
  );
  return { tiles, total, pageSize, page };
}

function compareTiles(a: OpFinderTile, b: OpFinderTile, sort: OpSort): number {
  switch (sort) {
    case 'price-desc':
      return (b.priceEur ?? -Infinity) - (a.priceEur ?? -Infinity);
    case 'price-asc':
      return (a.priceEur ?? Infinity) - (b.priceEur ?? Infinity);
    case 'cost-asc':
      return (a.gamedata.cost ?? Infinity) - (b.gamedata.cost ?? Infinity) ||
        a.name.localeCompare(b.name);
    case 'power-desc':
      return (b.gamedata.power ?? -Infinity) - (a.gamedata.power ?? -Infinity) ||
        a.name.localeCompare(b.name);
    case 'set-newest': {
      const ad = a.set?.released_at ? Date.parse(a.set.released_at) : 0;
      const bd = b.set?.released_at ? Date.parse(b.set.released_at) : 0;
      return bd - ad || a.name.localeCompare(b.name);
    }
    case 'name':
    default:
      return a.name.localeCompare(b.name);
  }
}

function pickImage(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const obj = images as Record<string, unknown>;
  for (const key of ['large', 'normal', 'small']) {
    const v = obj[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

