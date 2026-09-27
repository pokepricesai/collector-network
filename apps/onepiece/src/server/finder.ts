import 'server-only';
import {
  getPrintingsForCards,
  type TcgCard,
  type TcgPrinting,
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

  // Price sorts use a dedicated price-table-first path so the ranking
  // reflects the true top of the market across the WHOLE catalogue,
  // not just an alphabetical slice. Every other sort (name, cost,
  // power, set-newest) uses the anchor-first flow below.
  if (sort === 'price-desc' || sort === 'price-asc') {
    return queryFinderByPrice(
      supabase, gameId, filters,
      sort === 'price-asc' ? 'asc' : 'desc',
      page, pageSize, sets,
    );
  }

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
  // → up to ~4,000 rows in the pricing lookup. Price-based sorts
  // already returned via the price-first path above, so the only
  // remaining reasons to load full pricing here are the price-range
  // and onlyPriced filters.
  const needsFullPricing =
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

// ── Price-first search path ──────────────────────────────────────
//
// For `sort=price-desc` / `sort=price-asc` we start from
// `tcg_market_prices_current`, ordered by price, so the top of the
// result set is the true top of the market across the whole
// catalogue — never bounded by an alphabetical anchor pre-cap. The
// flow:
//
//   1. Pull the top N priced OP printings ordered by EUR price
//      (chunked via `.range()` to bypass PostgREST's 1,000-row cap).
//   2. Look up each printing's row (chunked `.in()`).
//   3. Look up the parent card for each printing (chunked `.in()`).
//   4. Group cards by name; walk price rows in order and keep the
//      dearest priced printing per name (a logical card).
//   5. Choose an anchor per name: the highest-rarity card in the
//      group so the tile shows the chase-tier rarity badge.
//   6. Apply supported filters (colour, cardType, rarity, set,
//      numeric ranges, name search, price range) at the anchor level.
//   7. Slice to the visible page.
//
// EUR is the only currency OP prices are published in today —
// filtered at the DB level so we never mix currencies. If the feed
// gains USD in future, ranking must stay within a single currency.
async function queryFinderByPrice(
  supabase: ReturnType<typeof getOnepieceClient>,
  gameId: string,
  filters: OpFinderFilters,
  direction: 'asc' | 'desc',
  page: number,
  pageSize: number,
  sets: TcgSet[],
): Promise<OpFinderResult> {
  // How many top-priced rows to consider. 3,000 comfortably covers
  // every currently priced OP printing (the game has ~1,500 priced
  // printings on 2026-09-27) plus headroom for future growth.
  const TOP_N = 3000;
  const CHUNK = 1000;
  const priceChunks = Array.from({ length: Math.ceil(TOP_N / CHUNK) }, async (_, i) => {
    const from = i * CHUNK;
    const to = Math.min(from + CHUNK - 1, TOP_N - 1);
    return supabase
      .from('tcg_market_prices_current')
      .select('tcg_printing_id, price, currency')
      .eq('game_id', gameId)
      .eq('currency', 'EUR')
      .not('price', 'is', null)
      .order('price', { ascending: direction === 'asc' })
      .range(from, to);
  });
  const priceResults = await Promise.all(priceChunks);
  const priceRows: Array<{ printingId: string; price: number }> = [];
  for (const { data, error } of priceResults) {
    if (error) {
      throw new Error(`[finder] queryFinderByPrice tcg_market_prices_current: ${error.message}`);
    }
    for (const r of (data as Array<{ tcg_printing_id: string; price: number }> | null) ?? []) {
      if (r.price == null) continue;
      priceRows.push({ printingId: r.tcg_printing_id, price: r.price });
    }
  }
  // Re-sort across chunks so the final walk is strictly in price order.
  priceRows.sort((a, b) => direction === 'asc' ? a.price - b.price : b.price - a.price);

  if (priceRows.length === 0) {
    return { tiles: [], total: 0, pageSize, page };
  }

  const uniquePrintingIds = Array.from(new Set(priceRows.map((r) => r.printingId)));
  const IN_CHUNK = 200;

  // Fetch printings for the priced set.
  const printings: TcgPrinting[] = [];
  for (let i = 0; i < uniquePrintingIds.length; i += IN_CHUNK) {
    const slice = uniquePrintingIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('tcg_printings')
      .select('*')
      .in('id', slice);
    if (error) throw new Error(`[finder] queryFinderByPrice tcg_printings: ${error.message}`);
    printings.push(...((data as TcgPrinting[] | null) ?? []));
  }
  const printingById = new Map(printings.map((p) => [p.id, p]));

  // Fetch parent cards.
  const uniqueCardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const cards: TcgCard[] = [];
  for (let i = 0; i < uniqueCardIds.length; i += IN_CHUNK) {
    const slice = uniqueCardIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('id,name,collector_number,rarity,set_id,images,gamedata,game_id')
      .in('id', slice);
    if (error) throw new Error(`[finder] queryFinderByPrice tcg_cards: ${error.message}`);
    cards.push(...((data as TcgCard[] | null) ?? []));
  }
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // Group cards by name (logical card family).
  const byName = new Map<string, TcgCard[]>();
  for (const c of cards) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }

  // Filter check applied at ROW level (not name-group level). A
  // filter like `cardType=leader` must gate on THIS printing's card
  // being a Leader — otherwise a Character-rarity SP CARD priced at
  // €23k would surface just because some other Luffy printing is a
  // Leader. Rarity, colour and set have the same row-level meaning.
  //
  // Numeric jsonb filters (cost / power / counter / life) apply to the
  // card's gamedata; the name-group agnostic check reads them from
  // whichever card this printing points at.
  const rowMatches = (card: TcgCard): boolean => {
    if (filters.q && filters.q.trim().length >= 2) {
      const q = filters.q.trim().toLowerCase();
      if (!card.name.toLowerCase().includes(q)) return false;
    }
    if (filters.setId && card.set_id !== filters.setId) return false;
    if (filters.rarity && (card.rarity ?? '').toUpperCase() !== filters.rarity.toUpperCase()) {
      return false;
    }
    if (filters.cardType) {
      const raw = (card.gamedata as Record<string, unknown> | null | undefined)?.['cardType'];
      if (typeof raw !== 'string' || raw.toUpperCase() !== filters.cardType.toUpperCase()) {
        return false;
      }
    }
    const gd = toOpGamedata(card.gamedata);
    if (filters.attribute && gd.attribute !== filters.attribute) return false;
    if (filters.colour && filters.colour !== 'multi') {
      const cap = filters.colour.charAt(0).toUpperCase() + filters.colour.slice(1);
      const arr = (card.gamedata as Record<string, unknown> | null | undefined)?.['colors'];
      if (!Array.isArray(arr) || !(arr as unknown[]).includes(cap)) return false;
    } else if (filters.colour === 'multi') {
      const arr = (card.gamedata as Record<string, unknown> | null | undefined)?.['colors'];
      if (!Array.isArray(arr) || (arr as unknown[]).length < 2) return false;
    }
    if (filters.costMin != null && (gd.cost == null || gd.cost < filters.costMin)) return false;
    if (filters.costMax != null && (gd.cost == null || gd.cost > filters.costMax)) return false;
    if (filters.powerMin != null && (gd.power == null || gd.power < filters.powerMin)) return false;
    if (filters.powerMax != null && (gd.power == null || gd.power > filters.powerMax)) return false;
    if (filters.counterMin != null && (gd.counter == null || gd.counter < filters.counterMin)) return false;
    if (filters.counterMax != null && (gd.counter == null || gd.counter > filters.counterMax)) return false;
    if (filters.lifeMin != null && (gd.life == null || gd.life < filters.lifeMin)) return false;
    if (filters.lifeMax != null && (gd.life == null || gd.life > filters.lifeMax)) return false;
    return true;
  };

  // Anchor selection: prefer the highest-rarity MATCHING card in the
  // group. This scopes the tile display so /card-finder?cardType=
  // leader shows the Leader anchor (not a Character variant of the
  // same name).
  const rarityRank: Record<string, number> = {
    TR: 8, SEC: 7, 'SP CARD': 6, SR: 5, L: 4, R: 3, UC: 2, C: 1, P: 3,
  };
  const chooseAnchor = (matching: TcgCard[]): TcgCard =>
    [...matching].sort((a, b) =>
      (rarityRank[(b.rarity ?? '').toUpperCase()] ?? 0) -
      (rarityRank[(a.rarity ?? '').toUpperCase()] ?? 0),
    )[0]!;

  // Walk price rows in order. Only consider rows whose parent card
  // passes the row-level filter. First qualifying hit per name wins.
  const bestByName = new Map<string, { anchor: TcgCard; priceEur: number; printingId: string }>();
  for (const row of priceRows) {
    if (filters.priceMinEur != null && row.price < filters.priceMinEur) continue;
    if (filters.priceMaxEur != null && row.price > filters.priceMaxEur) continue;
    const printing = printingById.get(row.printingId);
    if (!printing) continue;
    const card = cardById.get(printing.tcg_card_id);
    if (!card) continue;
    if (!rowMatches(card)) continue;
    if (bestByName.has(card.name)) continue;

    // Anchor: highest-rarity card in the name group that ALSO matches
    // the filter. Falls back to `card` itself if nothing else matches.
    const bucket = byName.get(card.name) ?? [card];
    const matchingInBucket = bucket.filter(rowMatches);
    const anchor = matchingInBucket.length > 0 ? chooseAnchor(matchingInBucket) : card;

    bestByName.set(card.name, {
      anchor,
      priceEur: row.price,
      printingId: row.printingId,
    });
  }

  const setsById = new Map(sets.map((s) => [s.id, s]));

  // Iterating bestByName preserves the insertion order (which is the
  // price walk order) — pagination is a direct slice.
  const entries: Array<{ anchor: TcgCard; priceEur: number }> = [];
  for (const entry of bestByName.values()) {
    entries.push({ anchor: entry.anchor, priceEur: entry.priceEur });
  }

  // Count printings per visible tile — across every card in the name
  // group, from the printings we already fetched. Some parallels not
  // yet priced still count as printings; the count is only accurate
  // for name groups that were touched by the top-N price fetch.
  const printingsByName = new Map<string, number>();
  for (const p of printings) {
    const card = cardById.get(p.tcg_card_id);
    if (!card) continue;
    printingsByName.set(card.name, (printingsByName.get(card.name) ?? 0) + 1);
  }

  const total = entries.length;
  const start = page * pageSize;
  const window = entries.slice(start, start + pageSize);
  const tiles: OpFinderTile[] = window.map(({ anchor, priceEur }) => ({
    cardId: anchor.id,
    name: anchor.name,
    collectorNumber: anchor.collector_number,
    rarity: anchor.rarity,
    gamedata: toOpGamedata(anchor.gamedata),
    set: setsById.get(anchor.set_id) ?? null,
    imageUrl: pickImage(anchor.images),
    href: `/card/${slugifyCardName(anchor.name)}`,
    priceEur,
    printingCount: printingsByName.get(anchor.name) ?? 0,
  }));
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

