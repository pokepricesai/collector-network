import type { SupabaseClient, TcgCard, TcgSet } from '@collector-network/database';
import { getSetsByIds } from '@collector-network/database';
import {
  getRetailQuotesForPrintings,
  selectPreferredRetailQuote,
  type RetailQuote,
} from '@collector-network/market-data';
import { getYugiohClient } from './read';
import { safe } from './safe';

const YGO_GAME_ID = 'ygo';

// The banlist enum values actually stored in production
// (verified 2026-09-24): 'unlimited' | 'limited' | 'forbidden' |
// 'semi_limited' (note the underscore — not hyphen).
export type BanlistState =
  | 'forbidden'
  | 'limited'
  | 'semi_limited'
  | 'unlimited';

export const RESTRICTED_STATES: readonly BanlistState[] = [
  'forbidden',
  'limited',
  'semi_limited',
];

export interface FnlCardEntry {
  card: TcgCard;
  set: TcgSet | null;
  archetypes: string[];
  attribute: string | null;
  frameType: string | null;
  bestUsdRetail: RetailQuote | null;
}

export interface FnlSectionData {
  state: BanlistState;
  tcgCount: number;
  ocgCount: number;
  cards: FnlCardEntry[]; // scoped to TCG state
}

export interface FnlPageData {
  tcg: {
    forbidden: FnlSectionData;
    limited: FnlSectionData;
    semi_limited: FnlSectionData;
  };
  ocgCounts: Record<BanlistState, number>;
  fetchedAt: string;
  totalCardsScanned: number;
  pricingDegraded: boolean;
}

// One-shot fetch of every TCG-restricted card. There are only ~1200
// restricted cards across the F&L states so this fits comfortably in
// a single un-paginated PostgREST response with the default 1000-row
// cap; we still paginate via range for safety.
async function fetchByBanlistState(
  supabase: SupabaseClient,
  scope: 'tcg' | 'ocg',
  state: BanlistState,
): Promise<TcgCard[]> {
  const cards: TcgCard[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const to = from + PAGE - 1;
    // PostgREST syntax for JSON path filter: gamedata->banlist->>tcg=eq.forbidden
    const filterPath =
      scope === 'tcg' ? 'gamedata->banlist->>tcg' : 'gamedata->banlist->>ocg';
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .eq('game_id', YGO_GAME_ID)
      .filter(filterPath, 'eq', state)
      .range(from, to);
    if (error) {
      throw new Error(
        `[yugioh/fnl] fetchByBanlistState(${scope}, ${state}): ${error.message}`,
      );
    }
    const rows = (data as TcgCard[] | null) ?? [];
    cards.push(...rows);
    if (rows.length < PAGE) break;
  }
  return cards;
}

async function countByBanlistState(
  supabase: SupabaseClient,
  scope: 'tcg' | 'ocg',
  state: BanlistState,
): Promise<number> {
  const filterPath =
    scope === 'tcg' ? 'gamedata->banlist->>tcg' : 'gamedata->banlist->>ocg';
  const { count, error } = await supabase
    .from('tcg_cards')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', YGO_GAME_ID)
    .filter(filterPath, 'eq', state);
  if (error) {
    throw new Error(
      `[yugioh/fnl] countByBanlistState(${scope}, ${state}): ${error.message}`,
    );
  }
  return count ?? 0;
}

export async function getYugiohForbiddenLimited(
  supabase: SupabaseClient = getYugiohClient(),
): Promise<FnlPageData> {
  const [
    tcgForbidden,
    tcgLimited,
    tcgSemiLimited,
    ocgForbiddenCount,
    ocgLimitedCount,
    ocgSemiLimitedCount,
  ] = await Promise.all([
    fetchByBanlistState(supabase, 'tcg', 'forbidden'),
    fetchByBanlistState(supabase, 'tcg', 'limited'),
    fetchByBanlistState(supabase, 'tcg', 'semi_limited'),
    countByBanlistState(supabase, 'ocg', 'forbidden'),
    countByBanlistState(supabase, 'ocg', 'limited'),
    countByBanlistState(supabase, 'ocg', 'semi_limited'),
  ]);

  const allCards = [...tcgForbidden, ...tcgLimited, ...tcgSemiLimited];

  // Deduplicate cards by name for the entry list — the ~1200 restricted
  // "tcg_cards" rows include many reprints (per-rarity, per-set
  // variants). Collectors expect one row per named card.
  const uniqueByName = new Map<string, TcgCard>();
  for (const c of allCards) {
    if (!uniqueByName.has(c.name)) uniqueByName.set(c.name, c);
  }

  const setIds = Array.from(new Set(allCards.map((c) => c.set_id)));
  const sets = await getSetsByIds(supabase, setIds);
  const setsById = new Map(sets.map((s) => [s.id, s]));

  // Best-USD retail across every restricted card. Batched: we get
  // printings for the deduplicated card IDs, then a single retail
  // quote batch. Fail-soft — if pricing errors we still render.
  const cardIds = Array.from(uniqueByName.values()).map((c) => c.id);
  // The F&L pricing batch touches ~1200 unique cards and many thousands
  // of printings. Give it more headroom than the default 6s; the page
  // is ISR-cached for an hour so a slow first render is acceptable.
  const pricingResult = await safe(
    'fnl-pricing',
    async () => {
      if (cardIds.length === 0) return { pricing: new Map<string, RetailQuote>() };
      const { data: printingRows, error: pErr } = await supabase
        .from('tcg_printings')
        .select('id,tcg_card_id')
        .in('tcg_card_id', cardIds);
      if (pErr) throw new Error(pErr.message);
      const printings = (printingRows as Array<{ id: string; tcg_card_id: string }> | null) ?? [];
      const byCardId = new Map<string, string[]>();
      for (const p of printings) {
        const bucket = byCardId.get(p.tcg_card_id) ?? [];
        bucket.push(p.id);
        byCardId.set(p.tcg_card_id, bucket);
      }
      const quotes = await getRetailQuotesForPrintings(
        supabase,
        printings.map((p) => p.id),
      );
      const quotesByPrintingId = new Map<string, RetailQuote[]>();
      for (const q of quotes) {
        const bucket = quotesByPrintingId.get(q.printingId) ?? [];
        bucket.push(q);
        quotesByPrintingId.set(q.printingId, bucket);
      }
      const bestByCard = new Map<string, RetailQuote>();
      for (const [cardId, ids] of byCardId) {
        const flat = ids.flatMap((pid) => quotesByPrintingId.get(pid) ?? []);
        const best = selectPreferredRetailQuote(flat, 'USD');
        if (best) bestByCard.set(cardId, best);
      }
      return { pricing: bestByCard };
    },
    { timeoutMs: 20_000 },
  );
  const bestUsdByCardId = pricingResult.ok
    ? pricingResult.value.pricing
    : new Map<string, RetailQuote>();

  function toEntries(
    cards: TcgCard[],
    state: BanlistState,
    tcgCount: number,
    ocgCount: number,
  ): FnlSectionData {
    const uniqueSectionByName = new Map<string, TcgCard>();
    for (const c of cards) {
      if (!uniqueSectionByName.has(c.name)) uniqueSectionByName.set(c.name, c);
    }
    const entries: FnlCardEntry[] = Array.from(uniqueSectionByName.values()).map((card) => {
      const gd = card.gamedata ?? {};
      return {
        card,
        set: setsById.get(card.set_id) ?? null,
        archetypes: (gd['archetypes'] as string[] | undefined) ?? [],
        attribute: (gd['attribute'] as string | undefined) ?? null,
        frameType: (gd['frameType'] as string | undefined) ?? null,
        bestUsdRetail: bestUsdByCardId.get(card.id) ?? null,
      };
    });
    // Sort alphabetically for a stable, browsable order.
    entries.sort((a, b) => a.card.name.localeCompare(b.card.name));
    return { state, tcgCount, ocgCount, cards: entries };
  }

  return {
    tcg: {
      forbidden: toEntries(
        tcgForbidden,
        'forbidden',
        tcgForbidden.length,
        ocgForbiddenCount,
      ),
      limited: toEntries(
        tcgLimited,
        'limited',
        tcgLimited.length,
        ocgLimitedCount,
      ),
      semi_limited: toEntries(
        tcgSemiLimited,
        'semi_limited',
        tcgSemiLimited.length,
        ocgSemiLimitedCount,
      ),
    },
    ocgCounts: {
      forbidden: ocgForbiddenCount,
      limited: ocgLimitedCount,
      semi_limited: ocgSemiLimitedCount,
      unlimited: 0, // not shown as a section
    },
    fetchedAt: new Date().toISOString(),
    totalCardsScanned: allCards.length,
    pricingDegraded: !pricingResult.ok,
  };
}
