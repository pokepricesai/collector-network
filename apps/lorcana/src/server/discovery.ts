import 'server-only';
import type { SupabaseClient, TcgCard, TcgPrinting, TcgSet } from '@collector-network/database';
import { getRetailQuotesForPrintings, selectPreferredRetailQuote } from '@collector-network/market-data';
import { getLorcanaClient, getLorcanaGameId } from './client';

// Discovery queries — the audit-derived surface that powers homepage,
// market, Enchanted spotlight, ink pages, chase discovery. Every
// helper degrades to an empty list on failure and never throws to
// callers.
//
// Ground truth: docs/lorcana/data-audit.md.
//   * 6 days of daily retail history → no movers board yet.
//   * ~94% of cards have some graded row; retail is refreshed daily.
//   * chase axis lives on tcg_cards.rarity, not tcg_printings.
//   * ~90% of cards have foil + nonfoil, ~10% one finish only.

export interface DiscoveryTile {
  cardId: string;
  printingId: string;
  name: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  finish: string | null;
  imageUrl: string | null;
  /** Numeric retail price in the source currency. Renderers should
   *  consult `priceCurrency` before adding a symbol. Kept named
   *  `priceUsd` for callsite compatibility across the app. */
  priceUsd: number;
  /** Source currency the numeric value is denominated in. */
  priceCurrency: 'USD' | 'EUR' | 'GBP' | 'JPY' | string;
  /** Legacy EUR field kept for callsites that specifically want an
   *  EUR value; null when the source isn't EUR. New code should read
   *  `priceUsd` + `priceCurrency`. */
  priceEur: number | null;
  ink: string | null;
}

// Chunk an array — used to keep PostgREST `in` filter URLs under the
// 8KB header limit. Set 1 has 400+ printings when foil + nonfoil are
// counted, so a single .in() query would 500 on us.
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/** Pick the largest available image from the shared TcgCardImages blob. */
function pickImage(images: unknown): string | null {
  if (!images || typeof images !== 'object') return null;
  const img = images as Record<string, unknown>;
  for (const k of ['normal', 'large', 'small']) {
    const v = img[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

interface CandidatePrice {
  cardId: string;
  printingId: string;
  priceUsd: number;
  priceEur: number | null;
  finish: string | null;
}

/** Fetch the cheapest-per-printing USD retail from a set of printing IDs
 *  in chunked batches so we don't blow the URL budget. */
async function priceLookup(
  supabase: SupabaseClient,
  printingIds: readonly string[],
): Promise<Map<string, { usd: number; eur: number | null }>> {
  const out = new Map<string, { usd: number; eur: number | null }>();
  if (printingIds.length === 0) return out;

  const chunks = chunk(printingIds, 100);
  const quoteBatches = await Promise.all(
    chunks.map((batch) => getRetailQuotesForPrintings(supabase, batch)),
  );
  const flat = quoteBatches.flat();

  const byPrinting = new Map<string, typeof flat>();
  for (const q of flat) {
    const b = byPrinting.get(q.printingId) ?? [];
    b.push(q);
    byPrinting.set(q.printingId, b);
  }

  for (const [pid, quotes] of byPrinting) {
    const usdQuote = selectPreferredRetailQuote(quotes, 'USD');
    const eurQuote = selectPreferredRetailQuote(quotes, 'EUR');
    if (usdQuote?.price != null) {
      out.set(pid, {
        usd: usdQuote.price,
        eur: eurQuote?.price ?? null,
      });
    }
  }
  return out;
}

interface DiscoveryQueryOpts {
  /** Filter cards by rarity string (case-sensitive on the DB value). */
  rarity?: string | string[];
  /** Filter cards by ink (gamedata.ink). */
  ink?: string;
  /** Filter cards by set. */
  setId?: string;
  /** Limit on candidate cards fetched before pricing (raise for wider
   *  populations e.g. all Enchanted). */
  cardCandidates?: number;
  /** Only pick priced cards; hide the rest. */
  limit: number;
}

/** Pull the top-N most-valuable cards.
 *
 *  Ranking policy (2026-09-27 rewrite):
 *    * Queries `tcg_market_prices_current` price-first and
 *      retail-list only.
 *    * Ranks WITHIN a single currency. Lorcana today has one live
 *      retail feed (Cardmarket EU / EUR). Any mixed-currency
 *      normalisation should be a shared market-data capability with a
 *      maintained FX source, not a fixed constant in a per-app query.
 *      If additional currencies appear in the feed later, a mixed
 *      list simply falls back to the dominant currency for ordering.
 *    * Picks the DEAREST retail-quality printing per card so the
 *      Iconic-foil or Enchanted-foil version leads.
 *    * Deduplicates by logical card so the same card's foil and
 *      nonfoil don't both crowd the top.
 *    * Outlier rule protects legitimate high-price promos: a row is
 *      discarded ONLY if BOTH (price >5x its 30-day average) AND
 *      (30-day average is at least a modest floor). A card whose
 *      30-day average is zero or trivial is treated as "new / thin
 *      history, keep it" — that covers late-run Promos, D23 exclusives
 *      and just-added Iconic prints where the trend has not caught up.
 *    * Supports optional rarity/set/ink filters (used by the market
 *      surfaces).
 */
export async function getPricedTiles(opts: DiscoveryQueryOpts): Promise<DiscoveryTile[]> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);

  // 1. Take a fat top-of-price slice from tcg_market_prices_current.
  //    We over-fetch by ~20x the limit to leave headroom for outlier
  //    exclusion and rarity/ink/set filtering downstream.
  const sliceLimit = Math.max(200, opts.limit * 20);
  const priceQ = supabase
    .from('tcg_market_prices_current')
    .select('tcg_printing_id, price, currency, avg_30d, finish, list_type, source, region')
    .eq('game_id', gameId)
    .eq('list_type', 'retail')
    .order('price', { ascending: false })
    .limit(sliceLimit);
  const { data: priceRowsRaw, error: priceErr } = await priceQ;
  if (priceErr || !priceRowsRaw) return [];

  interface PriceRow {
    tcg_printing_id: string;
    price: number;
    currency: string;
    avg_30d: number | null;
    finish: string | null;
    list_type: string | null;
    source: string | null;
    region: string | null;
  }
  const priceRows = priceRowsRaw as PriceRow[];

  // 2. Pick a single dominant currency to rank against. Today's Lorcana
  //    feed is single-currency (EUR) but we don't hardcode the choice —
  //    we pick whichever currency has the most rows in this slice.
  const currencyCounts = new Map<string, number>();
  for (const r of priceRows) {
    if (!r.currency) continue;
    currencyCounts.set(r.currency, (currencyCounts.get(r.currency) ?? 0) + 1);
  }
  let rankingCurrency: string | null = null;
  let bestCount = 0;
  for (const [ccy, count] of currencyCounts) {
    if (count > bestCount) { rankingCurrency = ccy; bestCount = count; }
  }
  if (!rankingCurrency) return [];

  // 3. Filter to the dominant currency + apply the outlier guard.
  //    Outlier rule: discard only if BOTH (price > 5x avg_30d) AND
  //    (avg_30d is a meaningful floor — >= 5 units in this currency).
  //    Legitimate scarce promos with thin trend history stay.
  const OUTLIER_FLOOR = 5;      // 5 EUR / USD — nothing below this is worth policing
  const OUTLIER_MULTIPLE = 5;   // 5x above trend
  const norm: { printingId: string; price: number; finish: string | null; source: string | null; region: string | null; currency: string }[] = [];
  for (const r of priceRows) {
    if (r.currency !== rankingCurrency) continue;
    if (r.price == null || r.price <= 0) continue;
    if (
      r.avg_30d != null &&
      r.avg_30d >= OUTLIER_FLOOR &&
      r.price > r.avg_30d * OUTLIER_MULTIPLE
    ) continue;
    norm.push({
      printingId: r.tcg_printing_id,
      price: r.price,
      currency: r.currency,
      finish: r.finish,
      source: r.source,
      region: r.region,
    });
  }
  if (norm.length === 0) return [];

  // 4. Resolve printings -> cards.
  const printingIds = Array.from(new Set(norm.map((n) => n.printingId)));
  const printingBatches = await Promise.all(
    chunk(printingIds, 100).map((batch) =>
      supabase.from('tcg_printings').select('*').in('id', batch as string[]),
    ),
  );
  const printings: TcgPrinting[] = [];
  for (const r of printingBatches) {
    if (!r.error) printings.push(...(((r.data as TcgPrinting[]) ?? [])));
  }
  if (printings.length === 0) return [];
  const printingsById = new Map(printings.map((p) => [p.id, p]));

  // 5. Fetch card metadata for the involved card_ids.
  const cardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const cardBatches = await Promise.all(
    chunk(cardIds, 100).map((batch) =>
      supabase.from('tcg_cards').select('id, name, set_id, collector_number, rarity, images, gamedata').in('id', batch as string[]),
    ),
  );
  let cards: TcgCard[] = [];
  for (const r of cardBatches) {
    if (!r.error) cards.push(...(((r.data as TcgCard[]) ?? [])));
  }

  // 6. Apply optional filters at the card level.
  if (opts.rarity) {
    const wanted = new Set(Array.isArray(opts.rarity) ? opts.rarity : [opts.rarity]);
    cards = cards.filter((c) => c.rarity && wanted.has(c.rarity));
  }
  if (opts.ink) {
    const inkLower = opts.ink.toLowerCase();
    cards = cards.filter((c) => {
      const gd = c.gamedata as Record<string, unknown> | null;
      return String(gd?.['ink'] ?? '').toLowerCase() === inkLower;
    });
  }
  if (opts.setId) cards = cards.filter((c) => c.set_id === opts.setId);
  if (cards.length === 0) return [];
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  // 7. For each card, pick the DEAREST retail-quality printing. This
  //    is the "most valuable" reading — a card's chase printing.
  interface Best {
    cardId: string; printingId: string; price: number; currency: string; finish: string | null; source: string | null; region: string | null;
  }
  const bestByCard = new Map<string, Best>();
  for (const n of norm) {
    const printing = printingsById.get(n.printingId);
    if (!printing) continue;
    if (!cardsById.has(printing.tcg_card_id)) continue;
    const cur = bestByCard.get(printing.tcg_card_id);
    if (!cur || n.price > cur.price) {
      bestByCard.set(printing.tcg_card_id, {
        cardId: printing.tcg_card_id,
        printingId: printing.id,
        price: n.price,
        currency: n.currency,
        finish: n.finish ?? printing.finish,
        source: n.source,
        region: n.region,
      });
    }
  }

  // 8. Fetch set metadata for labels.
  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
  const { data: setRows } = await supabase.from('tcg_sets').select('*').in('id', setIds as string[]);
  const setsById = new Map(((setRows as TcgSet[] | null) ?? []).map((s) => [s.id, s]));

  const tiles: DiscoveryTile[] = [];
  for (const [cardId, best] of bestByCard) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const set = setsById.get(card.set_id) ?? null;
    const gd = card.gamedata as Record<string, unknown> | null;
    tiles.push({
      cardId,
      printingId: best.printingId,
      name: card.name,
      setName: set?.name ?? null,
      setCode: set?.code ?? null,
      collectorNumber: card.collector_number,
      rarity: card.rarity,
      finish: best.finish,
      imageUrl: pickImage(card.images),
      // Preserve the source-currency value as the primary number.
      // Callers that render should switch on priceCurrency instead of
      // assuming USD. The legacy priceEur field stays populated only
      // when the source really is EUR.
      priceUsd: best.price,
      priceCurrency: best.currency,
      priceEur: best.currency === 'EUR' ? best.price : null,
      ink: (gd?.['ink'] as string | null) ?? null,
    });
  }

  // Sort by native price WITHIN the ranking currency. Because we
  // filtered to a single currency at step 3 the price scale is
  // consistent — no FX involved.
  tiles.sort((a, b) => {
    const av = a.priceEur ?? a.priceUsd;
    const bv = b.priceEur ?? b.priceUsd;
    return bv - av;
  });
  return tiles.slice(0, opts.limit);
}

/** Rarity distribution for a set. Feeds the set-page distribution
 *  panel and the /market/enchanted breakdown chart. */
export interface RarityDistribution {
  rarity: string;
  count: number;
  pct: number;
}
export async function getRarityDistributionForSet(
  setId: string,
  cards: readonly TcgCard[],
): Promise<RarityDistribution[]> {
  void setId;
  const counts = new Map<string, number>();
  for (const c of cards) {
    const r = c.rarity ?? 'Unknown';
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const total = cards.length;
  const RARITY_ORDER = [
    'Common', 'Uncommon', 'Rare', 'Super rare',
    'Legendary', 'Epic', 'Iconic', 'Enchanted', 'Promo',
  ];
  const rows: RarityDistribution[] = [];
  for (const rarity of RARITY_ORDER) {
    const n = counts.get(rarity);
    if (!n) continue;
    rows.push({ rarity, count: n, pct: total > 0 ? n / total : 0 });
    counts.delete(rarity);
  }
  for (const [rarity, n] of counts) {
    rows.push({ rarity, count: n, pct: total > 0 ? n / total : 0 });
  }
  return rows;
}

/** Split a set's priced value into nonfoil vs foil buckets so the set
 *  page can show the collector where the value actually sits. */
export interface FinishSplit {
  nonfoilTotal: number;
  foilTotal: number;
  nonfoilCount: number;
  foilCount: number;
  nonfoilCoverage: number;
  foilCoverage: number;
}
export async function getFinishSplitForSet(
  cards: readonly TcgCard[],
): Promise<FinishSplit> {
  const supabase = getLorcanaClient();
  if (cards.length === 0) {
    return {
      nonfoilTotal: 0, foilTotal: 0,
      nonfoilCount: 0, foilCount: 0,
      nonfoilCoverage: 0, foilCoverage: 0,
    };
  }
  const cardIds = cards.map((c) => c.id);
  const printingBatches = await Promise.all(
    chunk(cardIds, 100).map((batch) =>
      supabase.from('tcg_printings').select('*').in('tcg_card_id', batch as string[]),
    ),
  );
  const printings: TcgPrinting[] = [];
  for (const r of printingBatches) {
    if (!r.error) printings.push(...(((r.data as TcgPrinting[]) ?? [])));
  }
  const printingsById = new Map(printings.map((p) => [p.id, p]));
  const priced = await priceLookup(supabase, printings.map((p) => p.id));

  let nonfoilTotal = 0, foilTotal = 0;
  let nonfoilCount = 0, foilCount = 0;
  let nonfoilEligible = 0, foilEligible = 0;
  for (const p of printings) {
    const isNonfoil = (p.finish ?? '').toLowerCase() !== 'foil';
    if (isNonfoil) nonfoilEligible++;
    else foilEligible++;
    const price = priced.get(p.id);
    if (!price) continue;
    if (isNonfoil) {
      nonfoilTotal += price.usd;
      nonfoilCount++;
    } else {
      foilTotal += price.usd;
      foilCount++;
    }
  }
  return {
    nonfoilTotal,
    foilTotal,
    nonfoilCount,
    foilCount,
    nonfoilCoverage: nonfoilEligible > 0 ? nonfoilCount / nonfoilEligible : 0,
    foilCoverage: foilEligible > 0 ? foilCount / foilEligible : 0,
  };
}
