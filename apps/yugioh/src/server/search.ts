import {
  getCardsByArchetype,
  getCardsByCollectorNumber,
  getCardSuggestionsByPrefix,
  getPrintingsForCards,
  getSetsByIds,
  searchCardsByName,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
  type CardSuggestion,
} from '@collector-network/database';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
  type RetailQuote,
} from '@collector-network/market-data';
import { getYugiohClient } from './read';

// Yu-Gi-Oh! search composition. Interprets the query, dispatches to
// the right shared helper, and groups results the way Slice 2 §P/§O
// specified — logical-card families collapse the 69-Blue-Eyes case
// into a single result row, not 69 rows.

const YGO_GAME_ID = 'ygo';

// Detects strings that look like a set-code + collector-number.
// Matches: LOB-001, LOB001, LOB 001, LOB-EN001, RA05-EN001,
// L26D-ENS24, BLMM-EN001, and case-insensitive variants.
const SET_CODE_PATTERN = /^[A-Z0-9]{2,6}[\s-]?[A-Z]{0,4}\d{1,4}$/i;

export function looksLikeSetCode(query: string): boolean {
  const s = query.trim();
  return s.length >= 4 && s.length <= 16 && SET_CODE_PATTERN.test(s);
}

// Normalises "lob 001" and "lob001" to "LOB-001" so
// getCardsByCollectorNumber can find it. Preserves letters + digits,
// forces uppercase, inserts a dash between the first alpha run and the
// last digit run.
export function normaliseSetCode(query: string): string {
  const upper = query.trim().toUpperCase().replace(/\s+/g, '');
  if (upper.includes('-')) return upper;
  const m = upper.match(/^([A-Z0-9]*?[A-Z])(\d+)$/);
  if (!m) return upper;
  return `${m[1]}-${m[2]}`;
}

export interface CardVariant {
  card: TcgCard;
  set: TcgSet | null;
  printings: TcgPrinting[];
  bestUsdQuote: RetailQuote | null;
  bestEurQuote: RetailQuote | null;
}

export interface CardFamilyResult {
  kind: 'family';
  name: string;
  representativeImage: string | null;
  totalCards: number;
  totalPrintings: number;
  rarityRange: readonly string[];
  usdPriceLow: number | null;
  usdPriceHigh: number | null;
  variants: CardVariant[];
}

export interface SetCodeResult {
  kind: 'set-code';
  code: string;
  matches: CardVariant[];
}

export type SearchResult = CardFamilyResult | SetCodeResult;

export interface SearchResponse {
  query: string;
  interpretedAs: 'set-code' | 'name' | 'empty';
  results: SearchResult[];
  totalCardsScanned: number;
  serverMs: number;
  errors: string[];
}

export async function search(
  query: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<SearchResponse> {
  const start = performance.now();
  const cleaned = query.trim();
  if (cleaned.length === 0) {
    return {
      query: cleaned,
      interpretedAs: 'empty',
      results: [],
      totalCardsScanned: 0,
      serverMs: 0,
      errors: [],
    };
  }

  const errors: string[] = [];
  const interpretedAs: 'set-code' | 'name' = looksLikeSetCode(cleaned)
    ? 'set-code'
    : 'name';

  let cards: TcgCard[] = [];
  try {
    if (interpretedAs === 'set-code') {
      const normalised = normaliseSetCode(cleaned);
      cards = await getCardsByCollectorNumber(supabase, YGO_GAME_ID, normalised);
      // If the normalised set-code didn't match, fall through to name
      // search so a query like "sky striker" that happens to satisfy
      // the pattern still finds something.
      if (cards.length === 0) {
        cards = await searchCardsByName(supabase, YGO_GAME_ID, cleaned, 200);
      }
    } else {
      cards = await searchCardsByName(supabase, YGO_GAME_ID, cleaned, 200);
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const totalCardsScanned = cards.length;
  const results =
    interpretedAs === 'set-code' && cards.length > 0 && looksLikeSetCode(cleaned)
      ? [await buildSetCodeResult(supabase, cleaned, cards)]
      : await groupCardsByName(supabase, cards);

  return {
    query: cleaned,
    interpretedAs,
    results,
    totalCardsScanned,
    serverMs: Math.round(performance.now() - start),
    errors,
  };
}

// Groups a flat array of tcg_cards rows into logical-card families
// keyed on name. Each family contains up to N variants (rarity/set)
// with attached printings + best USD/EUR retail quote.
async function groupCardsByName(
  supabase: SupabaseClient,
  cards: TcgCard[],
): Promise<CardFamilyResult[]> {
  if (cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);
  const [printings, setsMap, printingQuotesByPrintingId] = await Promise.all([
    getPrintingsForCards(supabase, cardIds),
    (async () => {
      const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
      const sets = await getSetsByIds(supabase, setIds);
      return new Map(sets.map((s) => [s.id, s]));
    })(),
    (async () => {
      const allPrintings = await getPrintingsForCards(supabase, cardIds);
      const printingIds = allPrintings.map((p) => p.id);
      if (printingIds.length === 0) return new Map<string, RetailQuote[]>();
      const quotes = await getRetailQuotesForPrintings(supabase, printingIds);
      const map = new Map<string, RetailQuote[]>();
      for (const p of allPrintings) map.set(p.id, []);
      for (const q of quotes) {
        const bucket = map.get(q.printingId);
        if (bucket) bucket.push(q);
      }
      return map;
    })(),
  ]);

  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }

  const families = new Map<string, CardFamilyResult>();
  for (const card of cards) {
    const family =
      families.get(card.name) ??
      ({
        kind: 'family' as const,
        name: card.name,
        representativeImage: null,
        totalCards: 0,
        totalPrintings: 0,
        rarityRange: [] as string[],
        usdPriceLow: null as number | null,
        usdPriceHigh: null as number | null,
        variants: [] as CardVariant[],
      } satisfies CardFamilyResult);

    const cardPrintings = printingsByCardId.get(card.id) ?? [];
    const cardQuotes = cardPrintings.flatMap(
      (p) => printingQuotesByPrintingId.get(p.id) ?? [],
    );

    const bestUsd = selectPreferredRetailQuote(cardQuotes, 'USD');
    const bestEur = selectPreferredRetailQuote(cardQuotes, 'EUR');

    family.variants.push({
      card,
      set: setsMap.get(card.set_id) ?? null,
      printings: cardPrintings,
      bestUsdQuote: bestUsd,
      bestEurQuote: bestEur,
    });
    family.totalCards += 1;
    family.totalPrintings += cardPrintings.length;

    if (!family.representativeImage && card.images?.small) {
      family.representativeImage = card.images.small;
    }
    if (!family.representativeImage && card.images?.normal) {
      family.representativeImage = card.images.normal;
    }

    const rarityList = family.rarityRange as string[];
    if (card.rarity && !rarityList.includes(card.rarity)) rarityList.push(card.rarity);

    // USD price range from the best USD quote of every variant.
    if (bestUsd?.price != null) {
      family.usdPriceLow =
        family.usdPriceLow == null
          ? bestUsd.price
          : Math.min(family.usdPriceLow, bestUsd.price);
      family.usdPriceHigh =
        family.usdPriceHigh == null
          ? bestUsd.price
          : Math.max(family.usdPriceHigh, bestUsd.price);
    }

    families.set(card.name, family);
  }

  // Deterministic order: exact-name-match families first (bump to top
  // in `search()` when the query is a name), then by variant count desc.
  return Array.from(families.values()).sort(
    (a, b) => b.totalPrintings - a.totalPrintings,
  );
}

async function buildSetCodeResult(
  supabase: SupabaseClient,
  rawCode: string,
  cards: TcgCard[],
): Promise<SetCodeResult> {
  const families = await groupCardsByName(supabase, cards);
  const matches: CardVariant[] = families.flatMap((f) => f.variants);
  return {
    kind: 'set-code',
    code: rawCode.trim().toUpperCase(),
    matches,
  };
}

// Autocomplete suggestions. Uses prefix search which is fast against
// btree indexes even without pg_trgm. Groups by name so users don't
// see 40 Blue-Eyes entries.
export interface SuggestionItem {
  name: string;
  variantCount: number;
  representativeCollectorNumber: string | null;
  representativeRarity: string | null;
}

export async function suggest(
  query: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<SuggestionItem[]> {
  const cleaned = query.trim();
  if (cleaned.length < 2) return [];
  const rows: CardSuggestion[] = await getCardSuggestionsByPrefix(
    supabase,
    YGO_GAME_ID,
    cleaned,
    12,
  );
  const grouped = new Map<string, SuggestionItem>();
  for (const row of rows) {
    const existing = grouped.get(row.name);
    if (existing) {
      existing.variantCount += 1;
    } else {
      grouped.set(row.name, {
        name: row.name,
        variantCount: 1,
        representativeCollectorNumber: row.collector_number,
        representativeRarity: row.rarity,
      });
    }
  }
  return Array.from(grouped.values()).slice(0, 8);
}

// Archetype-scoped search, used when the query happens to name an
// archetype exactly. Not wired into the main search dispatcher yet —
// available for future archetype UI.
export async function searchArchetype(
  archetype: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<TcgCard[]> {
  return getCardsByArchetype(supabase, YGO_GAME_ID, archetype);
}
