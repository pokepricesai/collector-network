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
import {
  getPrintingPricingBatch,
  type PrintingPricing,
} from '@collector-network/market-data';
import { getOnepieceClient, getOnepieceGameId } from './client';
import { toOpGamedata, type OpGamedata } from '../lib/onepiece/gamedata';
import { inferTreatment, treatmentInfo, type OpTreatmentInfo } from '../lib/onepiece/treatment';
import { normaliseRarity, type OpRarity } from '../lib/onepiece/rarity';

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

/** Load every priced printing for the exact card name. */
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

  const treatment = treatmentInfo(
    inferTreatment({
      edition: printing.edition,
      finish: printing.finish,
      rarity: card.rarity,
    }),
  );

  return {
    card: {
      card,
      set: setsById.get(card.set_id) ?? null,
      rarity: normaliseRarity(card.rarity),
      gamedata: toOpGamedata(card.gamedata),
      printings: [
        {
          printing,
          set: setsById.get(card.set_id) ?? null,
          treatment,
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
      const treatment = treatmentInfo(
        inferTreatment({
          edition: printing.edition,
          finish: printing.finish,
          rarity: card.rarity,
        }),
      );
      return {
        printing,
        set: setsById.get(printing.set_id) ?? setsById.get(card.set_id) ?? null,
        treatment,
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
      gamedata: toOpGamedata(card.gamedata),
      printings: printingViews,
    };
  });

  return { name, cards: cardViews };
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
