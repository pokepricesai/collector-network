import 'server-only';
import type { TcgCard, TcgPrinting } from '@collector-network/database';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
} from '@collector-network/market-data';
import { getLorcanaClient, getLorcanaGameId } from './client';
import { getPrintingsForCards } from '@collector-network/database';
import { CURRENCY_SOURCE_KEY, DEFAULT_CURRENCY, type LorcanaCurrency } from '../lib/currency';

// Set-level market aggregate for Lorcana set pages. Mirrors the MTG
// methodology so numbers are comparable across the network:
//
//   * eligibleCount   = unique cards ingested for this set
//   * pricedCount     = eligible cards with at least one USD retail
//                       quote on any printing
//   * subtotalUsd     = sum of the CHEAPEST-per-card USD retail
//                       across every priced card
//   * coverage        = pricedCount / eligibleCount, clamped 0..1
//
// The "cheapest per card" basket avoids inflating totals with foil
// premiums. Missing quotes are counted as unpriced — never silently
// substituted with zero.

// Coverage threshold above which we call the number a "Set value"
// instead of a "Priced-card subtotal". Matches MTG.
export const SET_VALUE_COVERAGE_THRESHOLD = 0.8;

export interface LcSetTile {
  cardId: string;
  printingId: string;
  name: string;
  collectorNumber: string | null;
  rarity: string | null;
  imageUrl: string | null;
  priceUsd: number;
  /** Currency the numeric price is denominated in. Optional to keep
   *  legacy shape working; renderers default to USD when absent. */
  priceCurrency?: string;
  finish: string | null;
}

export interface LcSetMarket {
  eligibleCount: number;
  pricedCount: number;
  subtotalUsd: number;
  /** Currency of subtotalUsd and every tile price. */
  currency: string;
  coverage: number;
  mostValuable: LcSetTile[];
  cheapest: LcSetTile[];
  historyWindowNote: string;
}

export async function getSetMarketForLorcana(
  setId: string,
  cards: readonly TcgCard[],
  opts: {
    topN?: number;
    currency?: LorcanaCurrency;
    /** Pre-loaded printings for the set. When provided, skips the
     *  internal getPrintingsForCards call so a caller fetching
     *  getPrintingsBySet(setId) once at page level can share the result
     *  with other helpers (e.g. getFinishSplitForSet). */
    preloadedPrintings?: readonly TcgPrinting[];
  } = {},
): Promise<LcSetMarket> {
  const supabase = getLorcanaClient();
  void (await getLorcanaGameId(supabase));
  void setId;
  const topN = opts.topN ?? 5;
  const rankingCurrency: LorcanaCurrency = opts.currency ?? DEFAULT_CURRENCY;
  const rankingSource = CURRENCY_SOURCE_KEY[rankingCurrency];

  if (cards.length === 0) {
    return {
      eligibleCount: 0,
      pricedCount: 0,
      subtotalUsd: 0,
      currency: rankingCurrency,
      coverage: 0,
      mostValuable: [],
      cheapest: [],
      historyWindowNote:
        'History building — 7-day risers/fallers unlock once daily retail crosses the coverage bar.',
    };
  }

  const cardsById = new Map<string, TcgCard>(cards.map((c) => [c.id, c]));

  // Distinct logical cards keyed by name — mirrors what the set page
  // grid renders. For each name we pick a hero card (the anchor) so
  // valuation ties to a single row a user can click through to.
  const byName = new Map<string, TcgCard[]>();
  for (const c of cards) {
    const bucket = byName.get(c.name);
    if (bucket) bucket.push(c);
    else byName.set(c.name, [c]);
  }
  const heroes: TcgCard[] = [];
  for (const family of byName.values()) heroes.push(pickHero(family));

  const eligibleCount = heroes.length;

  // Fetch every printing for these heroes (not just the anchor row
  // itself — parallels sit under the same name family). We price at
  // the cheapest USD retail across the whole family so a parallel-
  // heavy card doesn't underprice the family by pinning to the base
  // rarity printing that isn't for sale.
  const heroCardIds = heroes.map((h) => h.id);
  const heroCardIdSet = new Set(heroCardIds);
  let printings: TcgPrinting[];
  if (opts.preloadedPrintings) {
    // Reuse the caller's set-wide printings — same tcg_card_id scope
    // once filtered down to heroes, so semantically identical to
    // getPrintingsForCards(heroCardIds).
    printings = opts.preloadedPrintings.filter((p) =>
      heroCardIdSet.has(p.tcg_card_id),
    );
  } else {
    printings = await getPrintingsForCards(supabase, heroCardIds);
  }
  const printingsByCard = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const list = printingsByCard.get(p.tcg_card_id) ?? [];
    list.push(p);
    printingsByCard.set(p.tcg_card_id, list);
  }
  const allPrintingIds = printings.map((p) => p.id);

  // Batch the retail-quote fetch. A Lorcana base set (e.g. Set 1) can
  // carry 400+ printings across its heroes — a single .in() would build
  // a URL longer than Supabase's PostgREST / undici tolerate. 100 per
  // request keeps the URL well under 8KB while still keeping the total
  // round-trip count small.
  const allRetailQuotes = (
    await Promise.all(
      chunk(allPrintingIds, 100).map((batch) =>
        getRetailQuotesForPrintings(supabase, batch),
      ),
    )
  ).flat();
  // Currency-scope: only keep quotes from the caller's selected native
  // marketplace + currency. USD → tcggraph.tcgplayer, EUR → tcggraph.cardmarket.
  // Never FX-converted; a printing with no native quote is unpriced.
  const retailQuotes = allRetailQuotes.filter(
    (q) => q.currency === rankingCurrency && q.source === rankingSource,
  );
  const quotesByPrinting = new Map<string, typeof retailQuotes>();
  for (const q of retailQuotes) {
    const b = quotesByPrinting.get(q.printingId) ?? [];
    b.push(q);
    quotesByPrinting.set(q.printingId, b);
  }

  const tiles: LcSetTile[] = [];
  for (const hero of heroes) {
    const heroPrintings = printingsByCard.get(hero.id) ?? [];
    if (heroPrintings.length === 0) continue;
    let cheapestOnHero: {
      price: number;
      printing: TcgPrinting;
    } | null = null;
    for (const p of heroPrintings) {
      const best = selectPreferredRetailQuote(quotesByPrinting.get(p.id) ?? [], rankingCurrency);
      if (best?.price == null) continue;
      if (cheapestOnHero == null || best.price < cheapestOnHero.price) {
        cheapestOnHero = { price: best.price, printing: p };
      }
    }
    if (cheapestOnHero) {
      tiles.push({
        cardId: hero.id,
        printingId: cheapestOnHero.printing.id,
        name: hero.name,
        collectorNumber: hero.collector_number,
        rarity: hero.rarity,
        imageUrl: pickTileImage(cardsById.get(hero.id) ?? hero),
        priceUsd: cheapestOnHero.price,
        priceCurrency: rankingCurrency,
        finish: cheapestOnHero.printing.finish,
      });
    }
  }

  const pricedCount = tiles.length;
  const subtotalUsd = tiles.reduce((n, t) => n + t.priceUsd, 0);
  const coverage = eligibleCount > 0 ? Math.min(1, Math.max(0, pricedCount / eligibleCount)) : 0;

  const byPriceDesc = [...tiles].sort((a, b) => b.priceUsd - a.priceUsd);
  const byPriceAsc = [...tiles].sort((a, b) => a.priceUsd - b.priceUsd);

  return {
    eligibleCount,
    pricedCount,
    subtotalUsd,
    currency: rankingCurrency,
    coverage,
    mostValuable: byPriceDesc.slice(0, topN),
    cheapest: byPriceAsc.slice(0, topN),
    historyWindowNote:
      'Risers/fallers hidden while daily retail history is under the 7-day honest coverage bar.',
  };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function pickHero(family: TcgCard[]): TcgCard {
  // Highest Lorcana rarity first; ties broken by collector-number.
  const order: Record<string, number> = {
    enchanted: 9, en: 9,
    iconic: 8, ic: 8,
    epic: 7, ep: 7,
    legendary: 6, l: 6,
    'super rare': 5, sr: 5,
    rare: 4, r: 4,
    uncommon: 3, u: 3, uc: 3,
    common: 2, c: 2,
    promo: 1, p: 1,
  };
  const sorted = [...family].sort((a, b) => {
    const av = order[(a.rarity ?? '').toLowerCase()] ?? 0;
    const bv = order[(b.rarity ?? '').toLowerCase()] ?? 0;
    if (av !== bv) return bv - av;
    return (a.collector_number ?? '').localeCompare(b.collector_number ?? '');
  });
  return sorted[0]!;
}

function pickTileImage(card: TcgCard): string | null {
  const img = card.images;
  if (!img) return null;
  return img.normal ?? img.large ?? img.small ?? null;
}
