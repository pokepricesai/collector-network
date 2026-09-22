import {
  createTcgClient,
  getCardById,
  getCardsByName,
  getGameBySlug,
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
import { toYugiohGamedata, type YugiohGamedata } from './gamedata.js';
import {
  editionDisplayLabel,
  normaliseEdition,
  type EditionMarker,
} from './edition.js';

// Yu-Gi-Oh! server-only composition layer. Composes the shared database +
// market-data primitives into shapes the (future) UI can render without
// having to know about the shared schema.
//
// This file is deliberately not exported from any package. It lives inside
// apps/yugioh so YGO semantics stay out of shared packages.

const YGO_GAME_SLUG = 'yugioh';
const YGO_GAME_ID = 'ygo';

export interface YugiohPrintingView {
  printing: TcgPrinting;
  set: TcgSet | null;
  edition: EditionMarker;
  editionLabel: string;
  pricing: PrintingPricing;
}

export interface YugiohCardView {
  card: TcgCard;
  set: TcgSet | null;
  gamedata: YugiohGamedata;
  printings: YugiohPrintingView[];
}

export interface YugiohCardBundle {
  // The logical card as searched — grouped by name. Multiple `cards` may
  // exist because tcg_cards is per-(set × collector_number × rarity) in
  // production, not per-logical-card.
  name: string;
  cards: YugiohCardView[];
}

let sharedClient: SupabaseClient | null = null;

export function getYugiohClient(): SupabaseClient {
  if (!sharedClient) sharedClient = createTcgClient();
  return sharedClient;
}

// Resolve the YGO row in tcg_games. Cheap; call once per request path.
export async function getYugiohGame(supabase: SupabaseClient = getYugiohClient()) {
  return getGameBySlug(supabase, YGO_GAME_SLUG);
}

export async function getYugiohCardBundleByName(
  name: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<YugiohCardBundle | null> {
  const cards = await getCardsByName(supabase, YGO_GAME_ID, name, {
    exact: true,
    limit: 200,
  });
  if (cards.length === 0) return null;
  return composeBundle(supabase, name, cards);
}

export async function getYugiohCardBundleByCardId(
  cardId: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<YugiohCardBundle | null> {
  const anchor = await getCardById(supabase, cardId);
  if (!anchor || anchor.game_id !== YGO_GAME_ID) return null;
  // Expand back to the full name family so callers see every reprint.
  const family = await getCardsByName(supabase, YGO_GAME_ID, anchor.name, {
    exact: true,
    limit: 200,
  });
  const cards = family.length > 0 ? family : [anchor];
  return composeBundle(supabase, anchor.name, cards);
}

export interface YugiohPrintingBundle {
  card: YugiohCardView;
}

export async function getYugiohPrintingBundle(
  printingId: string,
  supabase: SupabaseClient = getYugiohClient(),
): Promise<YugiohPrintingBundle | null> {
  const printing = await getPrintingById(supabase, printingId);
  if (!printing || printing.game_id !== YGO_GAME_ID) return null;
  const card = await getCardById(supabase, printing.tcg_card_id);
  if (!card) return null;
  const [sets, pricingMap] = await Promise.all([
    getSetsByIds(supabase, [card.set_id]),
    getPrintingPricingBatch(supabase, [printing.id]),
  ]);
  const setsById = new Map(sets.map((s) => [s.id, s]));
  const pricing = pricingMap.get(printing.id) ?? {
    printingId: printing.id,
    market: [],
    raw: [],
    graded: [],
  };
  const edition = normaliseEdition(printing.edition);
  return {
    card: {
      card,
      set: setsById.get(card.set_id) ?? null,
      gamedata: toYugiohGamedata(card.gamedata),
      printings: [
        {
          printing,
          set: setsById.get(card.set_id) ?? null,
          edition,
          editionLabel: editionDisplayLabel(edition),
          pricing,
        },
      ],
    },
  };
}

async function composeBundle(
  supabase: SupabaseClient,
  name: string,
  cards: TcgCard[],
): Promise<YugiohCardBundle> {
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

  const cardViews: YugiohCardView[] = cards.map((card) => {
    const cardPrintings = printingsByCard.get(card.id) ?? [];
    const printingViews: YugiohPrintingView[] = cardPrintings.map((printing) => {
      const edition = normaliseEdition(printing.edition);
      return {
        printing,
        set: setsById.get(printing.set_id) ?? null,
        edition,
        editionLabel: editionDisplayLabel(edition),
        pricing: pricingMap.get(printing.id) ?? {
          printingId: printing.id,
          market: [],
          raw: [],
          graded: [],
        },
      };
    });
    return {
      card,
      set: setsById.get(card.set_id) ?? null,
      gamedata: toYugiohGamedata(card.gamedata),
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
