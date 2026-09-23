import {
  countCardsInSet,
  getCardById,
  getCardsByName,
  getPrintingById,
  getRecentSets,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import {
  getMostValuableGradedPrintings,
  getMostValuableRetailPrintings,
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
  type GradedQuote,
  type RetailQuote,
} from '@collector-network/market-data';
import { getYugiohClient } from './read';

// Yu-Gi-Oh! homepage composition. Every section is fetched
// independently and failures are captured — one bad query does not
// break the page. Callers render whatever succeeded.
//
// Ambiguous vintage graded data is deliberately excluded — see
// docs/yugioh/data-audit.md §7 for the LOB-era edition/graded mismatch.
// We only surface graded highlights from printings whose parent set
// was released 2018-01-01 or later, where our audit confirmed edition
// splitting is reliable.

const YGO_GAME_ID = 'ygo';

// Iconic families — hard-coded curation, but each row is fetched live.
// Order matters (this is the display order).
const ICONIC_CARD_NAMES = [
  'Blue-Eyes White Dragon',
  'Dark Magician',
  'Red-Eyes Black Dragon',
  'Exodia the Forbidden One',
  'Slifer the Sky Dragon',
] as const;

const RARITY_DISCOVERY_SAMPLES = [
  'Ghost Rare',
  'Starlight Rare',
  'Quarter Century Secret Rare',
  "Collector's Rare",
  'Prismatic Secret Rare',
  'Ultimate Rare',
] as const;

export interface IconicCardFamily {
  name: string;
  totalPrintings: number;
  representativeImage: string | null;
  rarityRange: readonly string[];
  usdPriceLow: number | null;
  usdPriceHigh: number | null;
  hasGradedData: boolean;
}

export interface LatestSet {
  set: TcgSet;
  cardCount: number | null;
}

export interface GradedHighlight {
  printing: TcgPrinting;
  card: TcgCard;
  set: TcgSet | null;
  quote: GradedQuote;
}

export interface MostValuablePrinting {
  printing: TcgPrinting | null;
  card: TcgCard | null;
  set: TcgSet | null;
  quote: RetailQuote;
}

export interface RarityDiscoveryEntry {
  rarity: string;
  totalCards: number;
  representativeImage: string | null;
  exampleCards: Array<{ name: string; collectorNumber: string | null }>;
}

export interface HomepagePayload {
  iconicCards: IconicCardFamily[];
  latestSets: LatestSet[];
  gradedHighlights: GradedHighlight[];
  mostValuable: MostValuablePrinting[];
  rarityDiscovery: RarityDiscoveryEntry[];
  fetchedAt: string;
  errors: string[];
}

async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | Error> {
  try {
    return await fn();
  } catch (err) {
    return err instanceof Error
      ? Object.assign(err, { message: `[${label}] ${err.message}` })
      : new Error(`[${label}] ${String(err)}`);
  }
}

export async function getYugiohHomepageData(
  supabase: SupabaseClient = getYugiohClient(),
): Promise<HomepagePayload> {
  const errors: string[] = [];

  const [
    iconicRaw,
    latestSetsRaw,
    gradedRaw,
    mostValuableRaw,
    rarityRaw,
  ] = await Promise.all([
    safe('iconic', () => loadIconicCards(supabase)),
    safe('latestSets', () => loadLatestSets(supabase)),
    safe('gradedHighlights', () => loadGradedHighlights(supabase)),
    safe('mostValuable', () => loadMostValuable(supabase)),
    safe('rarityDiscovery', () => loadRarityDiscovery(supabase)),
  ]);

  const iconicCards = collectOr(iconicRaw, errors, []);
  const latestSets = collectOr(latestSetsRaw, errors, []);
  const gradedHighlights = collectOr(gradedRaw, errors, []);
  const mostValuable = collectOr(mostValuableRaw, errors, []);
  const rarityDiscovery = collectOr(rarityRaw, errors, []);

  return {
    iconicCards,
    latestSets,
    gradedHighlights,
    mostValuable,
    rarityDiscovery,
    fetchedAt: new Date().toISOString(),
    errors,
  };
}

function collectOr<T>(value: T | Error, errors: string[], fallback: T): T {
  if (value instanceof Error) {
    errors.push(value.message);
    return fallback;
  }
  return value;
}

async function loadIconicCards(supabase: SupabaseClient): Promise<IconicCardFamily[]> {
  const families = await Promise.all(
    ICONIC_CARD_NAMES.map(async (name) => {
      const cards = await getCardsByName(supabase, YGO_GAME_ID, name, {
        exact: true,
        limit: 200,
      });
      if (cards.length === 0) return null;

      const representativeImage =
        cards.find((c) => c.images?.small)?.images?.small ??
        cards.find((c) => c.images?.normal)?.images?.normal ??
        null;

      const rarities = Array.from(
        new Set(cards.map((c) => c.rarity).filter((r): r is string => !!r)),
      );

      const cardIds = cards.map((c) => c.id);
      const printings = await supabase
        .from('tcg_printings')
        .select('id')
        .in('tcg_card_id', cardIds);
      const printingIds = ((printings.data as Array<{ id: string }> | null) ?? []).map(
        (p) => p.id,
      );

      let usdPriceLow: number | null = null;
      let usdPriceHigh: number | null = null;
      if (printingIds.length > 0) {
        const quotes = await getRetailQuotesForPrintings(supabase, printingIds);
        const usdPrices = quotes
          .filter((q) => q.currency === 'USD' && q.price != null)
          .map((q) => q.price as number);
        if (usdPrices.length > 0) {
          usdPriceLow = Math.min(...usdPrices);
          usdPriceHigh = Math.max(...usdPrices);
        }
      }

      // Only claim "has graded data" for post-2018 printings — vintage
      // graded is contaminated by the LOB-era ingest issue. Cheap
      // heuristic: does any of the card's set_ids resolve to a set
      // released after the cutoff? Rather than fetch all sets we
      // approximate by trusting the presence of any graded row on any
      // printing whose id contains a modern set prefix. Simpler +
      // safer: just report false. UX text says "graded values on
      // detail pages" — no misleading badges on iconic tiles.
      const hasGradedData = false;

      const family: IconicCardFamily = {
        name,
        totalPrintings: printingIds.length,
        representativeImage,
        rarityRange: rarities,
        usdPriceLow,
        usdPriceHigh,
        hasGradedData,
      };
      return family;
    }),
  );
  return families.filter((f): f is IconicCardFamily => f !== null);
}

async function loadLatestSets(supabase: SupabaseClient): Promise<LatestSet[]> {
  const sets = await getRecentSets(supabase, YGO_GAME_ID, 8);
  const counts = await Promise.all(
    sets.map((s) =>
      countCardsInSet(supabase, s.id).catch(() => null),
    ),
  );
  return sets.map((set, i) => ({ set, cardCount: counts[i] ?? null }));
}

async function loadGradedHighlights(
  supabase: SupabaseClient,
): Promise<GradedHighlight[]> {
  // Post-attribution-fix: every attribution='printing' row is a safe
  // per-printing quote. The shared helper enforces both filters
  // (attribution + grader != raw). We still ask for grade 10 only
  // and a $200 floor to keep the headline lean.
  const top = await getMostValuableGradedPrintings(supabase, YGO_GAME_ID, {
    limit: 24,
    minPrice: 200,
    onlyGrade10: true,
  });
  if (top.length === 0) return [];

  const printingIds = top.map((t) => t.printingId);
  const { data: printingRows, error: pErr } = await supabase
    .from('tcg_printings')
    .select('*')
    .in('id', printingIds);
  if (pErr) throw new Error(pErr.message);
  const printings = (printingRows as TcgPrinting[] | null) ?? [];

  const cardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const cardsById = new Map<string, TcgCard>();
  if (cardIds.length > 0) {
    const { data: cardRows } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', cardIds);
    for (const c of (cardRows as TcgCard[] | null) ?? []) cardsById.set(c.id, c);
  }

  const setIds = Array.from(new Set(printings.map((p) => p.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  const printingsById = new Map(printings.map((p) => [p.id, p]));

  const highlights: GradedHighlight[] = [];
  const seenPrintings = new Set<string>();
  for (const t of top) {
    // De-dupe by printing so BGS/PSA/CGC/SGC of the same slab don't
    // occupy 4 tiles on the homepage. First occurrence wins (highest
    // price for that printing, since we ordered by price desc).
    if (seenPrintings.has(t.printingId)) continue;
    const printing = printingsById.get(t.printingId);
    if (!printing) continue;
    const card = cardsById.get(printing.tcg_card_id);
    if (!card) continue;
    const set = setsById.get(printing.set_id) ?? null;
    seenPrintings.add(t.printingId);
    highlights.push({ printing, card, set, quote: t.quote });
    if (highlights.length >= 8) break;
  }
  return highlights;
}

async function loadMostValuable(
  supabase: SupabaseClient,
): Promise<MostValuablePrinting[]> {
  // "Movers" fallback: no reliable history yet (forward-accumulating
  // ingest). We surface highest-priced current retail instead.
  const usd = await getMostValuableRetailPrintings(supabase, YGO_GAME_ID, {
    currency: 'USD',
    limit: 8,
    minPrice: 100,
  });
  if (usd.length === 0) return [];

  const printingIds = usd.map((r) => r.printingId);
  const { data: printingRows } = await supabase
    .from('tcg_printings')
    .select('*')
    .in('id', printingIds);
  const printings = (printingRows as TcgPrinting[] | null) ?? [];
  const printingsById = new Map(printings.map((p) => [p.id, p]));

  const cardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const cardsById = new Map<string, TcgCard>();
  if (cardIds.length > 0) {
    const { data: cardRows } = await supabase
      .from('tcg_cards')
      .select('*')
      .in('id', cardIds);
    for (const c of (cardRows as TcgCard[] | null) ?? []) cardsById.set(c.id, c);
  }

  const setIds = Array.from(new Set(printings.map((p) => p.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  return usd.map((r) => {
    const printing = printingsById.get(r.printingId) ?? null;
    const card = printing ? cardsById.get(printing.tcg_card_id) ?? null : null;
    const set = printing ? setsById.get(printing.set_id) ?? null : null;
    return { printing, card, set, quote: r.quote };
  });
}

async function loadRarityDiscovery(
  supabase: SupabaseClient,
): Promise<RarityDiscoveryEntry[]> {
  const entries = await Promise.all(
    RARITY_DISCOVERY_SAMPLES.map(async (rarity) => {
      const { data: sample, error: sErr } = await supabase
        .from('tcg_cards')
        .select('id,name,collector_number,images')
        .eq('game_id', 'ygo')
        .eq('rarity', rarity)
        .limit(3);
      if (sErr) return null;
      const rows = (sample as Array<{
        name: string;
        collector_number: string | null;
        images: { small?: string; normal?: string } | null;
      }> | null) ?? [];
      if (rows.length === 0) return null;
      const { count } = await supabase
        .from('tcg_cards')
        .select('id', { count: 'exact', head: true })
        .eq('game_id', 'ygo')
        .eq('rarity', rarity);
      const representativeImage =
        rows.find((r) => r.images?.small)?.images?.small ??
        rows.find((r) => r.images?.normal)?.images?.normal ??
        null;
      const entry: RarityDiscoveryEntry = {
        rarity,
        totalCards: count ?? rows.length,
        representativeImage,
        exampleCards: rows.map((r) => ({
          name: r.name,
          collectorNumber: r.collector_number,
        })),
      };
      return entry;
    }),
  );
  return entries.filter((e): e is RarityDiscoveryEntry => e !== null);
}

// Small helpers for currency selection on iconic tiles — re-exported
// so page components don't reach into the market-data package
// directly. Keeps YGO composition in this file.
export { selectPreferredRetailQuote };
export type { GradedQuote, RetailQuote };
// Re-export a couple of low-level helpers server pages need.
export { getCardById, getPrintingById };
