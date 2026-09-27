import 'server-only';
import type { TcgCard, TcgPrinting } from '@collector-network/database';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
} from '@collector-network/market-data';
import { getOnepieceClient, getOnepieceGameId } from './client';
import { getPrintingsForCards } from '@collector-network/database';

// Set-level market aggregate for OP set pages. Mirrors the MTG
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
//
// Movers (risers/fallers) are deliberately OUT of this pass: OP
// daily retail history is still under the honest 7-day window bar
// (production ingest began mid-Sep 2026). The set page renders a
// placeholder chip labelled "History building" instead.

// Coverage threshold above which we call the number a "Set value"
// instead of a "Priced-card subtotal". Matches MTG.
export const SET_VALUE_COVERAGE_THRESHOLD = 0.8;

export interface OpSetTile {
  cardId: string;
  printingId: string;
  name: string;
  collectorNumber: string | null;
  rarity: string | null;
  imageUrl: string | null;
  priceUsd: number;
  finish: string | null;
}

export interface OpSetMarket {
  eligibleCount: number;
  pricedCount: number;
  subtotalUsd: number;
  coverage: number;
  mostValuable: OpSetTile[];
  cheapest: OpSetTile[];
  historyWindowNote: string;
}

export async function getSetMarketForOp(
  setId: string,
  cards: readonly TcgCard[],
  opts: { topN?: number } = {},
): Promise<OpSetMarket> {
  const supabase = getOnepieceClient();
  void (await getOnepieceGameId(supabase));
  const topN = opts.topN ?? 5;

  if (cards.length === 0) {
    return {
      eligibleCount: 0,
      pricedCount: 0,
      subtotalUsd: 0,
      coverage: 0,
      mostValuable: [],
      cheapest: [],
      historyWindowNote:
        'History building — 7-day risers/fallers unlock once OP daily retail crosses the coverage bar.',
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
  const printings = await getPrintingsForCards(supabase, heroCardIds);
  const printingsByCard = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const list = printingsByCard.get(p.tcg_card_id) ?? [];
    list.push(p);
    printingsByCard.set(p.tcg_card_id, list);
  }
  const allPrintingIds = printings.map((p) => p.id);

  const retailQuotes = await getRetailQuotesForPrintings(supabase, allPrintingIds);
  const quotesByPrinting = new Map<string, typeof retailQuotes>();
  for (const q of retailQuotes) {
    const b = quotesByPrinting.get(q.printingId) ?? [];
    b.push(q);
    quotesByPrinting.set(q.printingId, b);
  }

  const tiles: OpSetTile[] = [];
  for (const hero of heroes) {
    const heroPrintings = printingsByCard.get(hero.id) ?? [];
    if (heroPrintings.length === 0) continue;
    let cheapestOnHero: {
      price: number;
      printing: TcgPrinting;
    } | null = null;
    for (const p of heroPrintings) {
      const best = selectPreferredRetailQuote(quotesByPrinting.get(p.id) ?? [], 'USD');
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
    coverage,
    mostValuable: byPriceDesc.slice(0, topN),
    cheapest: byPriceAsc.slice(0, topN),
    historyWindowNote:
      'Risers/fallers hidden while OP daily retail history is under the 7-day honest coverage bar.',
  };
}

function pickHero(family: TcgCard[]): TcgCard {
  const order: Record<string, number> = {
    SEC: 6, secret: 6, 'secret rare': 6,
    SR: 5, 'super rare': 5,
    L: 4, leader: 4,
    R: 3, rare: 3,
    UC: 2, uncommon: 2,
    C: 1, common: 1,
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
