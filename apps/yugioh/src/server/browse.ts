import {
  countCardsAndUniqueInSets,
  getCardsBySet,
  getPrintingsForCards,
  getRarityCounts,
  getSetByCodeInsensitive,
  getSetsByIds,
  listAllArchetypeEntries,
  listAllSets,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import {
  getPrintingPricingBatch,
  selectPreferredRetailQuote,
  type PrintingPricing,
  type RetailQuote,
} from '@collector-network/market-data';
import type { RarityFamily } from '../design/tokens';
import { normaliseRarity } from '../lib/rarity';
import { toCardSlug } from '../lib/slug';
import { getYugiohClient } from './read';
import { safe } from './safe';

const YGO_GAME_ID = 'ygo';

// ── Sets ──────────────────────────────────────────────────────────

export interface SetDirectoryEntry {
  set: TcgSet;
  // Total tcg_cards rows in the set. One card printed at multiple
  // rarities becomes multiple rows, so this is the "variants" count
  // rather than the collector-facing unique-card count.
  variantCount: number;
  // Distinct card names in the set. Matches how collectors describe
  // set size ("111 cards in LOB" not "126 variants").
  uniqueCardCount: number;
}

export async function listYugiohSetsForDirectory(
  supabase: SupabaseClient = getYugiohClient(),
): Promise<SetDirectoryEntry[]> {
  const sets = await listAllSets(supabase, YGO_GAME_ID);
  const counts = await countCardsAndUniqueInSets(
    supabase,
    sets.map((s) => s.id),
  );
  return sets.map((set) => {
    const c = counts.get(set.id);
    return {
      set,
      variantCount: c?.variantCount ?? 0,
      uniqueCardCount: c?.uniqueCardCount ?? 0,
    };
  });
}

export interface SetPageCardEntry {
  card: TcgCard;
  printings: TcgPrinting[];
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
  hasPrintingScopedGraded: boolean;
}

export interface SetPageData {
  set: TcgSet;
  cards: SetPageCardEntry[]; // one entry per tcg_cards row (variants)
  variantCount: number; // total variants (per-rarity rows)
  uniqueCardCount: number; // distinct card names in the set
  rarityBreakdown: Array<{ rarity: string; count: number }>;
  editionBreakdown: Array<{ edition: string; count: number }>;
  topByUsdPrice: SetPageCardEntry[];
  pricingDegraded: boolean;
}

export async function getYugiohSetBySlug(
  slug: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<SetPageData | null> {
  const set = await getSetByCodeInsensitive(supabase, YGO_GAME_ID, slug);
  if (!set) return null;

  const cards = await getCardsBySet(supabase, set.id);
  if (cards.length === 0) {
    return {
      set,
      cards: [],
      variantCount: 0,
      uniqueCardCount: 0,
      rarityBreakdown: [],
      editionBreakdown: [],
      topByUsdPrice: [],
      pricingDegraded: false,
    };
  }

  const cardIds = cards.map((c) => c.id);
  const printings = await getPrintingsForCards(supabase, cardIds);
  const printingIds = printings.map((p) => p.id);
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }

  const pricingResult = await safe('set-pricing', () =>
    getPrintingPricingBatch(supabase, printingIds),
  );
  const pricingMap = pricingResult.ok
    ? pricingResult.value
    : new Map<string, PrintingPricing>();

  const entries: SetPageCardEntry[] = cards.map((card) => {
    const cardPrintings = printingsByCardId.get(card.id) ?? [];
    const marketQuotes = cardPrintings.flatMap(
      (p) => pricingMap.get(p.id)?.market ?? [],
    );
    const hasPrintingScopedGraded = cardPrintings.some(
      (p) => (pricingMap.get(p.id)?.graded.length ?? 0) > 0,
    );
    return {
      card,
      printings: cardPrintings,
      bestUsdRetail: selectPreferredRetailQuote(marketQuotes, 'USD'),
      bestEurRetail: selectPreferredRetailQuote(marketQuotes, 'EUR'),
      hasPrintingScopedGraded,
    };
  });

  const rarityCounts = new Map<string, number>();
  for (const e of entries) {
    const r = e.card.rarity;
    if (!r) continue;
    rarityCounts.set(r, (rarityCounts.get(r) ?? 0) + 1);
  }
  const rarityBreakdown = Array.from(rarityCounts.entries())
    .map(([rarity, count]) => ({ rarity, count }))
    .sort((a, b) => b.count - a.count);

  const editionCounts = new Map<string, number>();
  for (const e of entries) {
    for (const p of e.printings) {
      const key = p.edition ?? 'unlimited_or_unknown';
      editionCounts.set(key, (editionCounts.get(key) ?? 0) + 1);
    }
  }
  const editionBreakdown = Array.from(editionCounts.entries())
    .map(([edition, count]) => ({ edition, count }))
    .sort((a, b) => b.count - a.count);

  const topByUsdPrice = [...entries]
    .filter((e) => e.bestUsdRetail?.price != null)
    .sort(
      (a, b) => (b.bestUsdRetail?.price ?? 0) - (a.bestUsdRetail?.price ?? 0),
    )
    .slice(0, 8);

  const uniqueCardCount = new Set(entries.map((e) => e.card.name)).size;

  return {
    set,
    cards: entries,
    variantCount: entries.length,
    uniqueCardCount,
    rarityBreakdown,
    editionBreakdown,
    topByUsdPrice,
    pricingDegraded: !pricingResult.ok,
  };
}

// ── Rarities ──────────────────────────────────────────────────────

export interface RarityDirectoryEntry {
  family: RarityFamily;
  rarities: string[]; // raw production rarity names that map to this family
  totalCards: number;
}

export async function listYugiohRaritiesForDirectory(
  supabase: SupabaseClient = getYugiohClient(),
): Promise<RarityDirectoryEntry[]> {
  const counts = await getRarityCounts(supabase, YGO_GAME_ID);
  const byFamily = new Map<RarityFamily, RarityDirectoryEntry>();
  for (const [rarity, count] of counts) {
    const family = normaliseRarity(rarity);
    const entry =
      byFamily.get(family) ??
      ({ family, rarities: [] as string[], totalCards: 0 } as RarityDirectoryEntry);
    entry.rarities = Array.from(new Set([...entry.rarities, rarity])).sort();
    entry.totalCards += count;
    byFamily.set(family, entry);
  }
  return Array.from(byFamily.values()).sort(
    (a, b) => b.totalCards - a.totalCards,
  );
}

export interface RarityPageCardEntry {
  card: TcgCard;
  set: TcgSet | null;
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
}

export interface RarityPageData {
  family: RarityFamily;
  rarities: string[]; // raw production values that map to this family
  totalCards: number;
  cards: RarityPageCardEntry[]; // sample, capped
  latestSets: Array<{ set: TcgSet; count: number }>;
  topByUsdPrice: RarityPageCardEntry[];
  pricingDegraded: boolean;
  truncated: boolean;
}

const RARITY_PAGE_CARD_CAP = 200;

export async function getYugiohRarityBySlug(
  slug: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<RarityPageData | null> {
  const family = slug as RarityFamily;
  const counts = await getRarityCounts(supabase, YGO_GAME_ID);
  const rarities: string[] = [];
  let totalCards = 0;
  for (const [rarity, count] of counts) {
    if (normaliseRarity(rarity) === family) {
      rarities.push(rarity);
      totalCards += count;
    }
  }
  if (rarities.length === 0) return null;

  // Fetch cards for every rarity in the family, capped at
  // RARITY_PAGE_CARD_CAP for the page (a directory page shouldn't
  // stream all 17k Commons).
  const cards: TcgCard[] = [];
  for (const rarity of rarities) {
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .eq('game_id', YGO_GAME_ID)
      .eq('rarity', rarity)
      .limit(Math.min(RARITY_PAGE_CARD_CAP - cards.length, 1000));
    if (error) throw new Error(`[yugioh/browse] rarity cards: ${error.message}`);
    cards.push(...(((data as TcgCard[] | null) ?? [])));
    if (cards.length >= RARITY_PAGE_CARD_CAP) break;
  }

  const truncated = totalCards > cards.length;

  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  const cardIds = cards.map((c) => c.id);
  const printings = await getPrintingsForCards(supabase, cardIds);
  const printingIds = printings.map((p) => p.id);
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }
  const pricingResult = await safe('rarity-pricing', () =>
    getPrintingPricingBatch(supabase, printingIds),
  );
  const pricingMap = pricingResult.ok
    ? pricingResult.value
    : new Map<string, PrintingPricing>();

  const entries: RarityPageCardEntry[] = cards.map((card) => {
    const cardPrintings = printingsByCardId.get(card.id) ?? [];
    const marketQuotes = cardPrintings.flatMap(
      (p) => pricingMap.get(p.id)?.market ?? [],
    );
    return {
      card,
      set: setsById.get(card.set_id) ?? null,
      bestUsdRetail: selectPreferredRetailQuote(marketQuotes, 'USD'),
      bestEurRetail: selectPreferredRetailQuote(marketQuotes, 'EUR'),
    };
  });

  const setCounts = new Map<string, number>();
  for (const e of entries) {
    if (!e.set) continue;
    setCounts.set(e.set.id, (setCounts.get(e.set.id) ?? 0) + 1);
  }
  const latestSets = Array.from(setCounts.entries())
    .map(([setId, count]) => ({ set: setsById.get(setId)!, count }))
    .filter((s) => s.set)
    .sort((a, b) => {
      const releaseA = a.set.released_at ?? '';
      const releaseB = b.set.released_at ?? '';
      return releaseB.localeCompare(releaseA);
    })
    .slice(0, 12);

  const topByUsdPrice = [...entries]
    .filter((e) => e.bestUsdRetail?.price != null)
    .sort(
      (a, b) => (b.bestUsdRetail?.price ?? 0) - (a.bestUsdRetail?.price ?? 0),
    )
    .slice(0, 8);

  return {
    family,
    rarities,
    totalCards,
    cards: entries,
    latestSets,
    topByUsdPrice,
    pricingDegraded: !pricingResult.ok,
    truncated,
  };
}

// ── Archetypes ─────────────────────────────────────────────────────

export interface ArchetypeDirectoryEntry {
  name: string;
  slug: string;
  cardCount: number;
}

// Slice 7 archetype directory. Aggregates every gamedata.archetypes
// tag across all ~38k cards. Slow-ish (~15s cold) but revalidate=1h
// on the directory page + full-workspace ISR softens the cost.
export async function listYugiohArchetypesForDirectory(
  supabase: SupabaseClient = getYugiohClient(),
): Promise<ArchetypeDirectoryEntry[]> {
  const entries = await listAllArchetypeEntries(supabase, YGO_GAME_ID);
  const counts = new Map<string, number>();
  for (const e of entries) {
    for (const arc of e.archetypes) {
      counts.set(arc, (counts.get(arc) ?? 0) + 1);
    }
  }
  // De-duplicate slugs. If two distinct archetype names slug the same
  // (rare), keep the higher-count as the canonical target and mark the
  // other as an alias — audited by the route uniqueness script.
  const bySlug = new Map<string, ArchetypeDirectoryEntry>();
  for (const [name, count] of counts) {
    const slug = toCardSlug(name);
    const existing = bySlug.get(slug);
    if (!existing) {
      bySlug.set(slug, { name, slug, cardCount: count });
    } else if (count > existing.cardCount) {
      bySlug.set(slug, { name, slug, cardCount: count });
    }
  }
  return Array.from(bySlug.values()).sort(
    (a, b) => b.cardCount - a.cardCount,
  );
}

export interface ArchetypePageCardEntry {
  card: TcgCard;
  set: TcgSet | null;
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
}

export interface ArchetypePageData {
  name: string;
  slug: string;
  cards: ArchetypePageCardEntry[];
  frameTypeBreakdown: Array<{ frameType: string; count: number }>;
  attributeBreakdown: Array<{ attribute: string; count: number }>;
  setsRepresented: Array<{ set: TcgSet; count: number }>;
  topByUsdPrice: ArchetypePageCardEntry[];
  banlistBreakdown: Array<{ state: string; count: number }>;
  pricingDegraded: boolean;
}

export async function getYugiohArchetypeBySlug(
  slug: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<ArchetypePageData | null> {
  const entries = await listAllArchetypeEntries(supabase, YGO_GAME_ID);
  const matchingCardIds: string[] = [];
  let canonicalName = '';
  let canonicalCount = 0;
  const nameCounts = new Map<string, number>();
  for (const e of entries) {
    for (const arc of e.archetypes) {
      if (toCardSlug(arc) === slug) {
        matchingCardIds.push(e.cardId);
        nameCounts.set(arc, (nameCounts.get(arc) ?? 0) + 1);
      }
    }
  }
  for (const [name, count] of nameCounts) {
    if (count > canonicalCount) {
      canonicalName = name;
      canonicalCount = count;
    }
  }
  if (matchingCardIds.length === 0) return null;

  // Fetch full card rows for the matches.
  const uniqIds = Array.from(new Set(matchingCardIds));
  const cards: TcgCard[] = [];
  for (let i = 0; i < uniqIds.length; i += 500) {
    const batch = uniqIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', batch);
    if (error) throw new Error(`[yugioh/browse] archetype cards: ${error.message}`);
    cards.push(...(((data as TcgCard[] | null) ?? [])));
  }

  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  const cardIds = cards.map((c) => c.id);
  const printings = await getPrintingsForCards(supabase, cardIds);
  const printingsByCardId = new Map<string, TcgPrinting[]>();
  for (const p of printings) {
    const bucket = printingsByCardId.get(p.tcg_card_id) ?? [];
    bucket.push(p);
    printingsByCardId.set(p.tcg_card_id, bucket);
  }
  const pricingResult = await safe('archetype-pricing', () =>
    getPrintingPricingBatch(supabase, printings.map((p) => p.id)),
  );
  const pricingMap = pricingResult.ok
    ? pricingResult.value
    : new Map<string, PrintingPricing>();

  const entryList: ArchetypePageCardEntry[] = cards.map((card) => {
    const cardPrintings = printingsByCardId.get(card.id) ?? [];
    const marketQuotes = cardPrintings.flatMap(
      (p) => pricingMap.get(p.id)?.market ?? [],
    );
    return {
      card,
      set: setsById.get(card.set_id) ?? null,
      bestUsdRetail: selectPreferredRetailQuote(marketQuotes, 'USD'),
      bestEurRetail: selectPreferredRetailQuote(marketQuotes, 'EUR'),
    };
  });

  const frameTypeCounts = new Map<string, number>();
  const attributeCounts = new Map<string, number>();
  const banlistCounts = new Map<string, number>();
  const setCounts = new Map<string, number>();
  for (const e of entryList) {
    const gd = e.card.gamedata ?? {};
    const frame = (gd['frameType'] as string | undefined) ?? 'unknown';
    frameTypeCounts.set(frame, (frameTypeCounts.get(frame) ?? 0) + 1);
    const attr = (gd['attribute'] as string | undefined) ?? '';
    if (attr) attributeCounts.set(attr, (attributeCounts.get(attr) ?? 0) + 1);
    const banlist = gd['banlist'] as { tcg?: string } | undefined;
    const state = banlist?.tcg ?? 'unknown';
    banlistCounts.set(state, (banlistCounts.get(state) ?? 0) + 1);
    if (e.set) setCounts.set(e.set.id, (setCounts.get(e.set.id) ?? 0) + 1);
  }

  const setsRepresented = Array.from(setCounts.entries())
    .map(([setId, count]) => ({ set: setsById.get(setId)!, count }))
    .filter((s) => s.set)
    .sort((a, b) => {
      const rA = a.set.released_at ?? '';
      const rB = b.set.released_at ?? '';
      return rB.localeCompare(rA);
    })
    .slice(0, 16);

  const topByUsdPrice = [...entryList]
    .filter((e) => e.bestUsdRetail?.price != null)
    .sort(
      (a, b) => (b.bestUsdRetail?.price ?? 0) - (a.bestUsdRetail?.price ?? 0),
    )
    .slice(0, 8);

  return {
    name: canonicalName,
    slug,
    cards: entryList,
    frameTypeBreakdown: Array.from(frameTypeCounts.entries())
      .map(([frameType, count]) => ({ frameType, count }))
      .sort((a, b) => b.count - a.count),
    attributeBreakdown: Array.from(attributeCounts.entries())
      .map(([attribute, count]) => ({ attribute, count }))
      .sort((a, b) => b.count - a.count),
    setsRepresented,
    topByUsdPrice,
    banlistBreakdown: Array.from(banlistCounts.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count),
    pricingDegraded: !pricingResult.ok,
  };
}
