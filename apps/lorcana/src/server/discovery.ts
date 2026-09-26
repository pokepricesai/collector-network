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
  priceUsd: number;
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

/** Pull the top-N cards ordered by cheapest USD retail across their
 *  printings, filtered by rarity/ink/set. Used by:
 *    * homepage most-valuable
 *    * homepage Enchanted spotlight
 *    * market/enchanted / market/iconic / market/most-valuable */
export async function getPricedTiles(opts: DiscoveryQueryOpts): Promise<DiscoveryTile[]> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);

  const candidatesTarget = opts.cardCandidates ?? Math.max(200, opts.limit * 20);

  let cardsQ = supabase
    .from('tcg_cards')
    .select('id, name, set_id, collector_number, rarity, images, gamedata')
    .eq('game_id', gameId)
    .limit(candidatesTarget);
  if (opts.rarity) {
    if (Array.isArray(opts.rarity)) cardsQ = cardsQ.in('rarity', opts.rarity);
    else cardsQ = cardsQ.eq('rarity', opts.rarity);
  }
  if (opts.setId) cardsQ = cardsQ.eq('set_id', opts.setId);

  const { data: cardRows, error: cardsErr } = await cardsQ;
  if (cardsErr) return [];
  let cards = (cardRows as TcgCard[] | null) ?? [];

  if (opts.ink) {
    const inkLower = opts.ink.toLowerCase();
    cards = cards.filter((c) => {
      const gd = c.gamedata as Record<string, unknown> | null;
      return String(gd?.['ink'] ?? '').toLowerCase() === inkLower;
    });
  }
  if (cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  // Fetch printings for these cards.
  const printingBatches = await Promise.all(
    chunk(cardIds, 100).map((batch) =>
      supabase.from('tcg_printings').select('*').in('tcg_card_id', batch as string[]),
    ),
  );
  const printings: TcgPrinting[] = [];
  for (const r of printingBatches) {
    if (!r.error) printings.push(...(((r.data as TcgPrinting[]) ?? [])));
  }
  if (printings.length === 0) return [];

  const priced = await priceLookup(supabase, printings.map((p) => p.id));
  const printingsById = new Map(printings.map((p) => [p.id, p]));

  // For each card pick the CHEAPEST priced printing. This mirrors set
  // valuation: the shelf price of the card, not the foil premium.
  const perCardBest = new Map<string, { printing: TcgPrinting; usd: number; eur: number | null }>();
  for (const p of printings) {
    const price = priced.get(p.id);
    if (!price) continue;
    const cur = perCardBest.get(p.tcg_card_id);
    if (!cur || price.usd < cur.usd) {
      perCardBest.set(p.tcg_card_id, { printing: p, usd: price.usd, eur: price.eur });
    }
  }

  // Fetch set metadata for whichever set_ids we actually reference.
  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
  const { data: setRows } = await supabase.from('tcg_sets').select('*').in('id', setIds as string[]);
  const setsById = new Map(((setRows as TcgSet[] | null) ?? []).map((s) => [s.id, s]));

  const tiles: DiscoveryTile[] = [];
  for (const [cardId, best] of perCardBest) {
    const card = cardsById.get(cardId);
    if (!card) continue;
    const set = setsById.get(card.set_id) ?? null;
    const gd = card.gamedata as Record<string, unknown> | null;
    tiles.push({
      cardId,
      printingId: best.printing.id,
      name: card.name,
      setName: set?.name ?? null,
      setCode: set?.code ?? null,
      collectorNumber: card.collector_number,
      rarity: card.rarity,
      finish: best.printing.finish,
      imageUrl: pickImage(card.images),
      priceUsd: best.usd,
      priceEur: best.eur,
      ink: (gd?.['ink'] as string | null) ?? null,
    });
  }

  // Order by USD desc for "most valuable" contexts. Callers who want a
  // different order can re-sort.
  tiles.sort((a, b) => b.priceUsd - a.priceUsd);
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
