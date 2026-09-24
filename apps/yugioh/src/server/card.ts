import { unstable_cache } from 'next/cache';
import {
  getPrintingsForCards,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import {
  getCardScopedPricing,
  getCardScopedPricingForCards,
  getPrintingPricing,
  getPrintingPricingBatch,
  selectPreferredRetailQuote,
  type CardScopedPricing,
  type GradedQuote,
  type PrintingPricing,
  type RetailQuote,
} from '@collector-network/market-data';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { normaliseEdition, type EditionMarker } from './edition';
import { toYugiohGamedata, type YugiohGamedata } from './gamedata';
import { getYugiohClient } from './read';
import { safe } from './safe';
import { normalisePrintingKey, slugMatches, slugToIlikePattern, toCardSlug } from '../lib/slug';

// Yu-Gi-Oh! server-only composition for /card/[slug] and
// /card/[slug]/printing/[collector-number]/[printing-key]. Attribution
// is honoured strictly:
//   • per-printing pricing on printing pages
//   • card-scoped pricing always in its own labelled panel
//   • card-scoped quotes NEVER placed under a specific edition heading

const YGO_GAME_ID = 'ygo';

// ── Public shapes ─────────────────────────────────────────────────

export interface PrintingVariant {
  printing: TcgPrinting;
  card: TcgCard;
  set: TcgSet | null;
  edition: EditionMarker;
  printingKey: string;       // URL segment: normal / 1st-edition / foil / limited
  bestUsdRetail: RetailQuote | null;
  bestEurRetail: RetailQuote | null;
  printingScopedGraded: GradedQuote[]; // attribution='printing' slabs (grader != raw)
  printingScopedRaw: GradedQuote[];    // attribution='printing' raw observations
  marketQuotes: RetailQuote[];         // full retail listings
}

export interface LogicalCardData {
  name: string;
  slug: string;
  gamedata: YugiohGamedata;
  rulesText: string | null;
  representativeImage: string | null;
  representativeCard: TcgCard;
  cards: TcgCard[];
  sets: Map<string, TcgSet>;
  variants: PrintingVariant[];
  rarityRange: string[];
  editionRange: EditionMarker[];
  usdPriceLow: number | null;
  usdPriceHigh: number | null;
  cardScopedPricing: CardScopedPricing[]; // one entry per tcg_cards row
  // Slice 7 fail-soft: true when a secondary pricing read timed out or
  // errored. Card metadata still renders; the UI shows a "temporarily
  // unavailable" note over pricing panels.
  pricingDegraded: boolean;
}

export interface PhysicalPrintingData {
  card: TcgCard;
  set: TcgSet | null;
  printing: TcgPrinting;
  edition: EditionMarker;
  printingKey: string;
  gamedata: YugiohGamedata;
  pricing: PrintingPricing;
  cardScopedPricing: CardScopedPricing; // shown as a labelled "card-scoped" panel
  logicalSlug: string;
  siblingVariants: PrintingVariant[]; // other printings of the same card family
  // Slice 7 fail-soft: true when a secondary pricing read timed out.
  pricingDegraded: boolean;
}

// ── Logical card page loader ──────────────────────────────────────

async function _getYugiohLogicalCardBySlug(
  slug: string,
): Promise<LogicalCardData | null> {
  const supabase = getYugiohClient();
  const cleaned = slug.trim().toLowerCase();
  if (cleaned.length === 0) return null;

  // ILIKE with the slug's pattern narrows the DB scan; JS-side
  // re-slugging confirms an exact slug match to eliminate false
  // positives from cards whose names collide under the lossy slug.
  const ilikePattern = slugToIlikePattern(cleaned);
  const { data: candidates, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', YGO_GAME_ID)
    .ilike('name', ilikePattern)
    .limit(500);
  if (error) {
    throw new Error(
      `[yugioh/card] getYugiohLogicalCardBySlug(${slug}): ${error.message}`,
    );
  }
  const rows = (candidates as TcgCard[] | null) ?? [];
  const matching = rows.filter((c) => slugMatches(c.name, cleaned));
  if (matching.length === 0) return null;

  // Prefer the most common name if the slug happens to match multiple
  // distinct names (unlikely but possible). Group by name and pick the
  // largest bucket.
  const byName = new Map<string, TcgCard[]>();
  for (const c of matching) {
    const bucket = byName.get(c.name) ?? [];
    bucket.push(c);
    byName.set(c.name, bucket);
  }
  const [chosenName, cards] = Array.from(byName.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  )[0]!;

  return composeLogicalCard(supabase, chosenName, cleaned, cards);
}

// Per-slug composition cache. Same 30-minute TTL as set/rarity/
// archetype entities so pricing stays roughly aligned with those
// pages; identity work (printings + sets join) is where most of the
// gain comes from.
export const getYugiohLogicalCardBySlug = withCacheBypass(
  _getYugiohLogicalCardBySlug,
  unstable_cache(_getYugiohLogicalCardBySlug, ['ygo:logicalCardBySlug', 'v1'], {
    revalidate: CACHE_TTL.ENTITY_MEDIUM,
    tags: [CACHE_TAGS.CARD],
  }),
);

async function composeLogicalCard(
  supabase: SupabaseClient,
  name: string,
  slug: string,
  cards: TcgCard[],
): Promise<LogicalCardData> {
  const cardIds = cards.map((c) => c.id);
  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));

  // printings + sets are structural — a failure there means the page
  // can't render, so let those propagate. Pricing (both card-scoped and
  // printing-scoped) is secondary — wrap in safe() so a Supabase
  // hiccup renders a valid 200 with a "pricing unavailable" note
  // rather than a route-level 500 (Slice 6 cold-hit regression fix).
  const [printings, sets, cardScopedMapResult] = await Promise.all([
    getPrintingsForCards(supabase, cardIds),
    getSetsByIds(supabase, setIds),
    safe('card-scoped-pricing', () =>
      getCardScopedPricingForCards(supabase, cardIds),
    ),
  ]);

  const setsById = new Map(sets.map((s) => [s.id, s]));
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const printingPricingResult = await safe('printing-pricing', () =>
    getPrintingPricingBatch(supabase, printings.map((p) => p.id)),
  );
  const pricingByPrintingId = printingPricingResult.ok
    ? printingPricingResult.value
    : new Map<string, PrintingPricing>();
  const cardScopedMap = cardScopedMapResult.ok
    ? cardScopedMapResult.value
    : new Map<string, CardScopedPricing>();
  const pricingDegraded =
    !printingPricingResult.ok || !cardScopedMapResult.ok;

  const variants: PrintingVariant[] = printings.map((printing) => {
    const card = cardsById.get(printing.tcg_card_id)!;
    const set = setsById.get(printing.set_id) ?? null;
    const pricing = pricingByPrintingId.get(printing.id) ?? {
      printingId: printing.id,
      market: [],
      raw: [],
      graded: [],
    };
    return {
      printing,
      card,
      set,
      edition: normaliseEdition(printing.edition),
      printingKey: normalisePrintingKey(printing.tcggraph_printing_key),
      bestUsdRetail: selectPreferredRetailQuote(pricing.market, 'USD'),
      bestEurRetail: selectPreferredRetailQuote(pricing.market, 'EUR'),
      printingScopedGraded: pricing.graded,
      printingScopedRaw: pricing.raw,
      marketQuotes: pricing.market,
    } satisfies PrintingVariant;
  });

  // Sort variants deterministically: 1st Ed first, then limited, then
  // others; within a tier, most-recently-released set first; then by
  // set code + collector number for stability.
  variants.sort((a, b) => {
    const editionOrder = (e: EditionMarker) =>
      e === '1st_edition' ? 0 : e === 'limited' ? 1 : 2;
    if (editionOrder(a.edition) !== editionOrder(b.edition))
      return editionOrder(a.edition) - editionOrder(b.edition);
    const releaseA = a.set?.released_at ?? '';
    const releaseB = b.set?.released_at ?? '';
    if (releaseA !== releaseB) return releaseB.localeCompare(releaseA);
    return (a.printing.collector_number ?? '').localeCompare(
      b.printing.collector_number ?? '',
    );
  });

  const representativeCard =
    cards.find((c) => c.images?.large || c.images?.normal || c.images?.small) ??
    cards[0]!;
  const representativeImage =
    representativeCard.images?.large ??
    representativeCard.images?.normal ??
    representativeCard.images?.small ??
    null;

  const rarityRange = Array.from(
    new Set(cards.map((c) => c.rarity).filter((r): r is string => !!r)),
  );
  const editionRange = Array.from(new Set(variants.map((v) => v.edition)));

  const usdPrices = variants
    .map((v) => v.bestUsdRetail?.price)
    .filter((p): p is number => p != null);
  const usdPriceLow = usdPrices.length > 0 ? Math.min(...usdPrices) : null;
  const usdPriceHigh = usdPrices.length > 0 ? Math.max(...usdPrices) : null;

  const cardScopedPricing = cards
    .map((c) => cardScopedMap.get(c.id))
    .filter((cs): cs is CardScopedPricing => cs != null && (cs.raw.length > 0 || cs.graded.length > 0));

  return {
    name,
    slug,
    gamedata: toYugiohGamedata(representativeCard.gamedata),
    rulesText: representativeCard.rules_text,
    representativeImage,
    representativeCard,
    cards,
    sets: setsById,
    variants,
    rarityRange,
    editionRange,
    usdPriceLow,
    usdPriceHigh,
    cardScopedPricing,
    pricingDegraded,
  };
}

// ── Physical printing page loader ─────────────────────────────────

async function _getYugiohPhysicalPrintingByRoute(
  cardSlug: string,
  collectorNumber: string,
  printingKey: string,
): Promise<PhysicalPrintingData | null> {
  const supabase = getYugiohClient();
  const normalisedKey = normalisePrintingKey(printingKey);
  const upperCn = collectorNumber.trim().toUpperCase();

  const { data: cardRows, error: cErr } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', YGO_GAME_ID)
    .eq('collector_number', upperCn);
  if (cErr) {
    throw new Error(`[yugioh/printing] card lookup: ${cErr.message}`);
  }
  const cards = (cardRows as TcgCard[] | null) ?? [];
  const matchingCards = cards.filter((c) => slugMatches(c.name, cardSlug));
  if (matchingCards.length === 0) return null;

  // Prefer the card that has a printing matching the requested key.
  const cardIds = matchingCards.map((c) => c.id);
  const { data: printingRows, error: pErr } = await supabase
    .from('tcg_printings')
    .select('*')
    .in('tcg_card_id', cardIds);
  if (pErr) {
    throw new Error(`[yugioh/printing] printings lookup: ${pErr.message}`);
  }
  const printings = (printingRows as TcgPrinting[] | null) ?? [];
  const targetPrinting = printings.find(
    (p) => normalisePrintingKey(p.tcggraph_printing_key) === normalisedKey,
  );
  if (!targetPrinting) return null;

  const card = matchingCards.find((c) => c.id === targetPrinting.tcg_card_id);
  if (!card) return null;

  // Sibling variants: all other printings across the same-name family
  // (not just this tcg_cards row). Reuse the logical composition.
  const logical = await composeLogicalCard(
    supabase,
    card.name,
    cardSlug,
    matchingCards,
  );
  const siblingVariants = logical.variants.filter(
    (v) => v.printing.id !== targetPrinting.id,
  );

  // Fail-soft on pricing: metadata renders even if a Supabase call
  // times out or errors mid-stream. Set lookup is cheap and structural
  // so it stays outside safe().
  const [pricingResult, set, cardScopedResult] = await Promise.all([
    safe('printing-scoped-pricing', () =>
      getPrintingPricing(supabase, targetPrinting.id),
    ),
    (async () => {
      const sets = await getSetsByIds(supabase, [card.set_id]);
      return sets[0] ?? null;
    })(),
    safe('printing-card-scoped-pricing', () =>
      getCardScopedPricing(supabase, card.id),
    ),
  ]);
  const pricing: PrintingPricing = pricingResult.ok
    ? pricingResult.value
    : { printingId: targetPrinting.id, market: [], raw: [], graded: [] };
  const cardScoped: CardScopedPricing = cardScopedResult.ok
    ? cardScopedResult.value
    : { cardId: card.id, raw: [], graded: [] };

  return {
    card,
    set,
    printing: targetPrinting,
    edition: normaliseEdition(targetPrinting.edition),
    printingKey: normalisedKey,
    gamedata: toYugiohGamedata(card.gamedata),
    pricing,
    cardScopedPricing: cardScoped,
    logicalSlug: cardSlug,
    siblingVariants,
    pricingDegraded:
      logical.pricingDegraded ||
      !pricingResult.ok ||
      !cardScopedResult.ok,
  };
}

export const getYugiohPhysicalPrintingByRoute = withCacheBypass(
  _getYugiohPhysicalPrintingByRoute,
  unstable_cache(
    _getYugiohPhysicalPrintingByRoute,
    ['ygo:physicalPrintingByRoute', 'v1'],
    { revalidate: CACHE_TTL.ENTITY_MEDIUM, tags: [CACHE_TAGS.CARD] },
  ),
);

// ── Sitemap helpers ───────────────────────────────────────────────

export interface CardSitemapRow {
  slug: string;
  updatedAt: string | null;
}

// Cursor is now an offset number (encoded as string). Range-based
// paging via .range(from,to) sidesteps two production quirks:
//   1. Supabase's PostgREST default 1000-row cap on .limit()
//   2. Statement timeouts on ORDER BY id/name over 38k+ rows without
//      a hot index on the sort column.
// Rows come back in whatever the default order is (PK). That's fine
// for a sitemap since we de-dupe by slug application-side.
export async function listAllCardSlugs(
  supabase: SupabaseClient = getYugiohClient(),
  cursor: string | null = null,
): Promise<{ rows: CardSitemapRow[]; nextCursor: string | null }> {
  const from = cursor ? parseInt(cursor, 10) : 0;
  const PAGE = 1000; // PostgREST default cap; smaller = under timeout
  const to = from + PAGE - 1;
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('name,updated_at')
    .eq('game_id', YGO_GAME_ID)
    .range(from, to);
  if (error) {
    throw new Error(`[yugioh/card] listAllCardSlugs(from=${from}): ${error.message}`);
  }
  const rowsRaw =
    (data as Array<{ name: string; updated_at: string | null }> | null) ?? [];
  const dedup = rowsRaw.reduce<Map<string, string | null>>((acc, r) => {
    // De-duplicate by name within THIS batch. Cross-batch dedup is
    // still needed but happens in the caller (sitemap uses a Set).
    const name = (r.name ?? '').trim();
    if (!name) return acc;
    const prev = acc.get(name);
    if (!prev || (r.updated_at && r.updated_at > prev)) {
      acc.set(name, r.updated_at);
    }
    return acc;
  }, new Map());

  const out: CardSitemapRow[] = [];
  for (const [name, updatedAt] of dedup) {
    const s = toCardSlugSafe(name);
    if (s) out.push({ slug: s, updatedAt });
  }
  // Continue paging while the previous batch was full. When Supabase
  // returns fewer rows than requested we're at the tail.
  const nextCursor = rowsRaw.length === PAGE ? String(from + PAGE) : null;
  return { rows: out, nextCursor };
}

export interface PrintingSitemapRow {
  cardSlug: string;
  collectorNumber: string;
  printingKey: string;
  updatedAt: string | null;
}

// Same range-based paging as listAllCardSlugs. Cursor is offset-as-
// string. Sub-batches the card-name lookup so a page of 1000 printings
// resolves in ≤2 tcg_cards queries (each capped at ~500 IDs).
export async function listAllPrintingRoutes(
  supabase: SupabaseClient = getYugiohClient(),
  cursor: string | null = null,
): Promise<{ rows: PrintingSitemapRow[]; nextCursor: string | null }> {
  const from = cursor ? parseInt(cursor, 10) : 0;
  const PAGE = 1000;
  const to = from + PAGE - 1;
  const { data, error } = await supabase
    .from('tcg_printings')
    .select('id,tcg_card_id,collector_number,tcggraph_printing_key,updated_at')
    .eq('game_id', YGO_GAME_ID)
    .range(from, to);
  if (error) {
    throw new Error(
      `[yugioh/card] listAllPrintingRoutes(from=${from}): ${error.message}`,
    );
  }
  type PRow = {
    id: string;
    tcg_card_id: string;
    collector_number: string | null;
    tcggraph_printing_key: string | null;
    updated_at: string | null;
  };
  const printings = (data as PRow[] | null) ?? [];
  if (printings.length === 0) return { rows: [], nextCursor: null };

  const cardIds = Array.from(new Set(printings.map((p) => p.tcg_card_id)));
  const nameByCardId = new Map<string, string>();
  for (let i = 0; i < cardIds.length; i += 500) {
    const batch = cardIds.slice(i, i + 500);
    const { data: cardRows, error: cErr } = await supabase
      .from('tcg_cards')
      .select('id,name')
      .in('id', batch);
    if (cErr) throw new Error(`[yugioh/card] card-name lookup: ${cErr.message}`);
    for (const r of (cardRows as Array<{ id: string; name: string }> | null) ?? []) {
      nameByCardId.set(r.id, r.name);
    }
  }

  const out: PrintingSitemapRow[] = [];
  for (const p of printings) {
    const name = nameByCardId.get(p.tcg_card_id);
    if (!name || !p.collector_number) continue;
    const slug = toCardSlugSafe(name);
    if (!slug) continue;
    out.push({
      cardSlug: slug,
      collectorNumber: p.collector_number,
      printingKey: normalisePrintingKey(p.tcggraph_printing_key),
      updatedAt: p.updated_at,
    });
  }
  const nextCursor = printings.length === PAGE ? String(from + PAGE) : null;
  return { rows: out, nextCursor };
}

// Delegates to the canonical slugger in lib/slug.ts so the sitemap
// output stays byte-identical to what the /card/[slug] route resolves
// against. Returns null for names that would produce an empty slug.
function toCardSlugSafe(name: string): string | null {
  return toCardSlug(name) || null;
}
