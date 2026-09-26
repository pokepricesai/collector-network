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
import { getLorcanaClient, getLorcanaGameId } from './client';
import { toLcGamedata, type LcGamedata } from '../lib/lorcana/gamedata';
import { inferTreatment, type LcTreatmentInfo } from '../lib/lorcana/treatment';
import { normaliseRarity, type LcRarity } from '../lib/lorcana/rarity';

// Lorcana server-only composition layer.
//
// This is where the shared game-agnostic reads become Lorcana-native
// views. The UI never touches @collector-network/database directly — it
// always composes through here so the "printing → treatment → priced
// version" concept is one call.

export interface LcPrintingView {
  printing: TcgPrinting;
  set: TcgSet | null;
  treatment: LcTreatmentInfo;
  pricing: PrintingPricing;
  imageUrl: string | null;
}

export interface LcCardView {
  card: TcgCard;
  set: TcgSet | null;
  rarity: LcRarity;
  gamedata: LcGamedata;
  printings: LcPrintingView[];
}

/** A logical card family — one entry per (game_id, name) grouping.
 *  A single LcCardBundle bundles every priced physical printing of
 *  every rarity/treatment for a shared card name. */
export interface LcCardBundle {
  name: string;
  cards: LcCardView[];
}

/** Load every priced printing for the exact card name. */
export async function getCardBundleByName(
  name: string,
  supabase: SupabaseClient = getLorcanaClient(),
): Promise<LcCardBundle | null> {
  const gameId = await getLorcanaGameId(supabase);
  const cards = await getCardsByName(supabase, gameId, name, {
    exact: true,
    limit: 200,
  });
  if (cards.length === 0) return null;
  return composeBundle(supabase, name, cards);
}

/** Load a card family starting from a single tcg_cards row id. */
export async function getCardBundleByCardId(
  cardId: string,
  supabase: SupabaseClient = getLorcanaClient(),
): Promise<LcCardBundle | null> {
  const gameId = await getLorcanaGameId(supabase);
  const anchor = await getCardById(supabase, cardId);
  if (!anchor || anchor.game_id !== gameId) return null;
  const family = await getCardsByName(supabase, gameId, anchor.name, {
    exact: true,
    limit: 200,
  });
  const cards = family.length > 0 ? family : [anchor];
  return composeBundle(supabase, anchor.name, cards);
}

export interface LcPrintingBundle {
  card: LcCardView;
}

/** Load one specific printing exposed as a single-element card view. */
export async function getPrintingBundle(
  printingId: string,
  supabase: SupabaseClient = getLorcanaClient(),
): Promise<LcPrintingBundle | null> {
  const gameId = await getLorcanaGameId(supabase);
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

  const rarity = normaliseRarity(card.rarity);
  const treatment = inferTreatment({
    finish: printing.finish,
    rarity: rarity.code,
  });

  return {
    card: {
      card,
      set: setsById.get(card.set_id) ?? null,
      rarity,
      gamedata: lcGamedataFromCard(card),
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
): Promise<LcCardBundle> {
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

  const cardViews: LcCardView[] = cards.map((card) => {
    const rarity = normaliseRarity(card.rarity);
    const cardPrintings = printingsByCard.get(card.id) ?? [];
    const printingViews: LcPrintingView[] = cardPrintings.map((printing) => {
      const treatment = inferTreatment({
        finish: printing.finish,
        rarity: rarity.code,
      });
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
      rarity,
      gamedata: lcGamedataFromCard(card),
      printings: printingViews,
    };
  });

  return { name, cards: cardViews };
}

/** Build the LcGamedata view for a card, lifting `tcg_cards.rules_text`
 *  into `effectText` when the JSON `gamedata` doesn't carry it. */
function lcGamedataFromCard(card: TcgCard): LcGamedata {
  const parsed = toLcGamedata(card.gamedata);
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
