import 'server-only';
import {
  getCardById,
  getCardsByName,
  getPrintingById,
  getPrintingsForCards,
  getSetsByIds,
  type SupabaseClient,
  type TcgCard,
  type TcgPrinting,
  type TcgSet,
} from '@collector-network/database';
import { baseCollectorNumber, slugifyCardName } from '../lib/onepiece/slug';
import {
  getPrintingPricingBatch,
  type PrintingPricing,
} from '@collector-network/market-data';
import { getOnepieceClient, getOnepieceGameId } from './client';
import { toOpGamedata, type OpGamedata } from '../lib/onepiece/gamedata';
import {
  inferTreatment,
  treatmentInfo,
  type OpTreatmentInfo,
} from '../lib/onepiece/treatment';
import { normaliseRarity, type OpRarity } from '../lib/onepiece/rarity';
import { pickHeadlinePrice } from '../lib/onepiece/pick-headline';
import { pickCardImage } from '../lib/onepiece/image';

// One Piece server-only composition layer.
//
// This is where the shared game-agnostic reads become OP-native views.
// The UI never touches @collector-network/database directly — it always
// composes through here so the "printing → treatment → priced version"
// concept is one call.

export interface OpPrintingView {
  printing: TcgPrinting;
  set: TcgSet | null;
  treatment: OpTreatmentInfo;
  /** For parallels / reprints: the numeric index (`1` for `_p1`, etc.).
   *  Null on non-suffixed treatments. Rendered on the printing fingerprint. */
  variantIndex: number | null;
  pricing: PrintingPricing;
  imageUrl: string | null;
}

export interface OpCardView {
  card: TcgCard;
  set: TcgSet | null;
  rarity: OpRarity;
  gamedata: OpGamedata;
  printings: OpPrintingView[];
}

/** A logical card family — one entry per (game_id, name) grouping.
 *  A single OpCardBundle bundles every priced physical printing of
 *  every rarity/treatment for a shared card name. */
export interface OpCardBundle {
  name: string;
  cards: OpCardView[];
}

/** LEGACY: load every printing for the exact card name. This
 *  aggregates ALL distinct game cards sharing a name (dozens of
 *  Roronoa Zoros across sets) and MUST NOT be used for the logical-
 *  card page. Kept for admin/diagnostic callers only. */
export async function getCardBundleByName(
  name: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpCardBundle | null> {
  const gameId = await getOnepieceGameId(supabase);
  const cards = await getCardsByName(supabase, gameId, name, {
    exact: true,
    limit: 200,
  });
  if (cards.length === 0) return null;
  return composeBundle(supabase, name, cards);
}

/** Load a logical card family scoped to a single base collector
 *  number. The family is: the base card row (collector_number =
 *  baseCollector) plus every parallel (_p<n>) and reprint (_r<n>) of
 *  the same base. Different game cards with the same character name
 *  live in DIFFERENT families and are never merged here.
 *
 *  Name is passed only to disambiguate the rare case where two rows
 *  share a normalised collector-slug (unlikely; kept as a safety
 *  filter). Match uses the DB `name` column so treatments/artworks
 *  of the same slot but different DB names never accidentally merge.
 */
export async function getCardFamilyByBaseCollector(
  baseCollector: string,
  nameSlug: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpCardBundle | null> {
  const gameId = await getOnepieceGameId(supabase);
  const upper = baseCollector.toUpperCase();
  // Match base + `_p*` + `_r*` via ilike prefix. The upper() form is
  // what the DB stores.
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .or(
      `collector_number.eq.${upper},collector_number.ilike.${upper}\\_p%,collector_number.ilike.${upper}\\_r%`,
    );
  if (error) {
    console.error('[onepiece/read] getCardFamilyByBaseCollector query', error);
    return null;
  }
  const rows = (data as TcgCard[] | null) ?? [];
  if (rows.length === 0) return null;
  // Same base collector CAN in principle be reused in a different set
  // (starter set + main set share `ST01-001` shape sometimes) — filter
  // by the name-slug to keep the family cohesive when that happens.
  const matched = rows.filter((c) => slugifyCardName(c.name) === nameSlug);
  const family = matched.length > 0 ? matched : rows;
  const name = family[0]!.name;
  return composeBundle(supabase, name, family);
}

/** Reverse-lookup: given a base collector slug (e.g. `op13-037`), find
 *  every matching base collector number and return one candidate per
 *  distinct name. Used by the /card/[slug] route to pick the family
 *  when the user's slug has a collector prefix but the split between
 *  collector and name is ambiguous. */
export async function findCardsForCollectorSlug(
  collectorSlug: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<Array<{ baseCollector: string; name: string }>> {
  const gameId = await getOnepieceGameId(supabase);
  // The slug uses hyphens where the DB collector has hyphens; only
  // difference is case. Reconstruct the base collector by upper-casing.
  const target = collectorSlug.toUpperCase();
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('name,collector_number')
    .eq('game_id', gameId)
    .eq('collector_number', target)
    .limit(50);
  if (error) {
    console.error('[onepiece/read] findCardsForCollectorSlug', error);
    return [];
  }
  const rows = (data as { name: string; collector_number: string }[] | null) ?? [];
  const seen = new Set<string>();
  const out: Array<{ baseCollector: string; name: string }> = [];
  for (const r of rows) {
    const base = baseCollectorNumber(r.collector_number) ?? r.collector_number;
    const key = `${base}|${slugifyCardName(r.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ baseCollector: base, name: r.name });
  }
  return out;
}

/** Load a card family starting from a single tcg_cards row id. Useful
 *  for URL routes that resolve to a specific rarity row but want to
 *  present the full treatment family. */
export async function getCardBundleByCardId(
  cardId: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpCardBundle | null> {
  const gameId = await getOnepieceGameId(supabase);
  const anchor = await getCardById(supabase, cardId);
  if (!anchor || anchor.game_id !== gameId) return null;
  const family = await getCardsByName(supabase, gameId, anchor.name, {
    exact: true,
    limit: 200,
  });
  const cards = family.length > 0 ? family : [anchor];
  return composeBundle(supabase, anchor.name, cards);
}

/** Load ONE collectible variant only (a single tcg_cards row) and its
 *  own printings. This is Level B in the product model: same image,
 *  same collector number (including any `_p1` / `_p2` suffix), same
 *  price the Finder tile showed. Callers use this on the exact-
 *  variant destination page — the sibling parallels / reprints /
 *  reprints-of-reprints show up on the /card overview page instead.
 *
 *  The returned bundle has exactly one entry in `cards[]`, and
 *  `bundle.name` is that row's DB name. */
export async function getVariantBundle(
  cardId: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpCardBundle | null> {
  const gameId = await getOnepieceGameId(supabase);
  const row = await getCardById(supabase, cardId);
  if (!row || row.game_id !== gameId) return null;
  return composeBundle(supabase, row.name, [row]);
}

/** Sibling variants in the same base-collector family — i.e. every
 *  other collectible-variant row (base + `_p*` + `_r*`) that shares
 *  this variant's base collector number and DB name. Returns compact
 *  rows suitable for a "Other versions of Boa Hancock OP07-038" rail:
 *  own image, own collector number, own set code, own headline price
 *  (native currency of the row's marketplace). */
export interface OpSiblingVariant {
  cardId: string;
  cardName: string;
  collectorNumber: string | null;
  setCode: string | null;
  setName: string | null;
  imageUrl: string | null;
  headline: { price: number; currency: 'EUR' | 'USD'; signal: 'avg30d' | 'priceLow' | 'trend' } | null;
}
export async function getSiblingVariants(
  anchorCardId: string,
  currency: 'EUR' | 'USD',
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpSiblingVariant[]> {
  const gameId = await getOnepieceGameId(supabase);
  const anchor = await getCardById(supabase, anchorCardId);
  if (!anchor || anchor.game_id !== gameId) return [];
  const base = baseCollectorNumber(anchor.collector_number);
  if (!base) return [];
  const upper = base.toUpperCase();
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .or(
      `collector_number.eq.${upper},collector_number.ilike.${upper}\\_p%,collector_number.ilike.${upper}\\_r%`,
    );
  if (error) {
    console.error('[onepiece/read] getSiblingVariants query', error);
    return [];
  }
  const nameSlugTarget = slugifyCardName(anchor.name);
  const family = ((data as TcgCard[] | null) ?? []).filter(
    (c) => slugifyCardName(c.name) === nameSlugTarget && c.id !== anchor.id,
  );
  if (family.length === 0) return [];
  const cardIds = family.map((c) => c.id);
  const setIds = Array.from(new Set(family.map((c) => c.set_id)));
  const [printings, sets] = await Promise.all([
    getPrintingsForCards(supabase, cardIds),
    getSetsByIds(supabase, setIds),
  ]);
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const printingsByCard = groupBy(printings, (p) => p.tcg_card_id);
  const pricingMap = await getPrintingPricingBatch(
    supabase,
    printings.map((p) => p.id),
  );
  return family.map((c) => {
    const set = setsById.get(c.set_id) ?? null;
    const rows = printingsByCard.get(c.id) ?? [];
    let top: OpSiblingVariant['headline'] = null;
    for (const p of rows) {
      const pricing = pricingMap.get(p.id);
      if (!pricing?.market?.length) continue;
      const h = pickHeadlinePrice(pricing.market, currency);
      if (!h) continue;
      if (!top || h.price > top.price) top = { price: h.price, currency: h.currency, signal: h.signal };
    }
    return {
      cardId: c.id,
      cardName: c.name,
      collectorNumber: c.collector_number,
      setCode: set?.code ?? null,
      setName: set?.name ?? null,
      imageUrl: pickCardImage(c.images),
      headline: top,
    };
  });
}

export interface OpPrintingBundle {
  card: OpCardView;
}

/** Load one specific printing and expose it in the same OpCardView
 *  shape as bundle results (single-element printings[] array). Used by
 *  /set/[code]/card/[slug] pages that want a targeted view. */
export async function getPrintingBundle(
  printingId: string,
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<OpPrintingBundle | null> {
  const gameId = await getOnepieceGameId(supabase);
  const printing = await getPrintingById(supabase, printingId);
  if (!printing || printing.game_id !== gameId) return null;
  const card = await getCardById(supabase, printing.tcg_card_id);
  if (!card) return null;
  const [sets, pricingMap] = await Promise.all([
    getSetsByIds(supabase, [card.set_id]),
    getPrintingPricingBatch(supabase, [printing.id]),
  ]);
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const pricing =
    pricingMap.get(printing.id) ??
    ({ printingId: printing.id, market: [], raw: [], graded: [] } as PrintingPricing);

  const trace = inferTreatment({
    collectorNumber: card.collector_number,
    rarity: card.rarity,
    edition: printing.edition,
    finish: printing.finish,
  });

  return {
    card: {
      card,
      set: setsById.get(card.set_id) ?? null,
      rarity: normaliseRarity(card.rarity),
      gamedata: opGamedataFromCard(card),
      printings: [
        {
          printing,
          set: setsById.get(card.set_id) ?? null,
          treatment: treatmentInfo(trace.treatment),
          variantIndex: trace.variantIndex,
          pricing,
          imageUrl: null,
        },
      ],
    },
  };
}

async function composeBundle(
  supabase: SupabaseClient,
  name: string,
  cards: TcgCard[],
): Promise<OpCardBundle> {
  const cardIds = cards.map((c) => c.id);
  const setIds = Array.from(new Set(cards.map((c) => c.set_id)));

  const [printings, sets] = await Promise.all([
    getPrintingsForCards(supabase, cardIds),
    getSetsByIds(supabase, setIds),
  ]);

  const setsById = new Map(sets.map((s) => [s.id, s]));
  const printingsByCard = groupBy(printings, (p) => p.tcg_card_id);
  const allPrintingIds = printings.map((p) => p.id);
  const pricingMap = await getPrintingPricingBatch(supabase, allPrintingIds);

  const cardViews: OpCardView[] = cards.map((card) => {
    const cardPrintings = printingsByCard.get(card.id) ?? [];
    const printingViews: OpPrintingView[] = cardPrintings.map((printing) => {
      const trace = inferTreatment({
        collectorNumber: card.collector_number,
        rarity: card.rarity,
        edition: printing.edition,
        finish: printing.finish,
      });
      return {
        printing,
        set: setsById.get(printing.set_id) ?? setsById.get(card.set_id) ?? null,
        treatment: treatmentInfo(trace.treatment),
        variantIndex: trace.variantIndex,
        pricing:
          pricingMap.get(printing.id) ??
          ({
            printingId: printing.id,
            market: [],
            raw: [],
            graded: [],
          } as PrintingPricing),
        imageUrl: null,
      };
    });
    return {
      card,
      set: setsById.get(card.set_id) ?? null,
      rarity: normaliseRarity(card.rarity),
      gamedata: opGamedataFromCard(card),
      printings: printingViews,
    };
  });

  return { name, cards: cardViews };
}

/** Build the OpGamedata view for a card, lifting `tcg_cards.rules_text`
 *  into `effectText` when the JSON `gamedata` doesn't carry it.
 *
 *  Production reality (see docs/onepiece/data-audit.md §10):
 *    * `tcg_cards.gamedata` never includes effect text for OP.
 *    * `tcg_cards.rules_text` is populated on 91.8% of OP rows and
 *      carries the effect line (e.g. `[On Play] Draw 1 card.`).
 *
 *  This is done here rather than inside `toOpGamedata` because the
 *  gamedata parser is shape-only — it doesn't know about the top-level
 *  card columns. Keeping the merge in the composition layer means the
 *  parser stays a pure function of the JSON blob.
 */
function opGamedataFromCard(card: TcgCard): OpGamedata {
  const parsed = toOpGamedata(card.gamedata);
  const rulesText = (card.rules_text ?? '').trim();
  if (rulesText.length > 0 && !parsed.effectText) {
    return { ...parsed, effectText: rulesText };
  }
  return parsed;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
