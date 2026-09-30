import 'server-only';
import type { TcgCard } from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';
import { getPricedTiles, type DiscoveryTile } from './discovery';
import { DEFAULT_CURRENCY, type LorcanaCurrency } from '../lib/currency';

// Server-side card finder. All filters land as URL query params so
// results are shareable, indexable (once launched) and back-button
// friendly. No client-side state.
//
// Filters supported (audit-backed):
//   ink       — one of the six canonical inks
//   rarity    — one of the nine rarity tiers
//   cardType  — CHARACTER / ACTION / ITEM / LOCATION
//   inkable   — 'true' or 'false'
//   set       — set code (lowercase)
//   q         — name substring (case-insensitive)
//   sort      — 'price-desc' | 'price-asc' | 'name-asc'

export interface FindFilters {
  ink?: string | null;
  rarity?: string | null;
  cardType?: string | null;
  inkable?: 'true' | 'false' | null;
  set?: string | null;
  q?: string | null;
  sort?: 'price-desc' | 'price-asc' | 'name-asc' | null;
  /** Optional min/max cutoffs on the currency-matched retail price.
   *  Applied AFTER currency-scoping so the same numeric axis is used
   *  as the sort. */
  priceMin?: number | null;
  priceMax?: number | null;
}

export interface FindResult {
  tiles: DiscoveryTile[];
  totalMatched: number;
  truncated: boolean;
  filters: FindFilters;
}

const MAX_RESULTS = 60;
const CANDIDATE_TARGET = 400;

/** Case-insensitive rarity normalisation to the canonical DB value. */
const RARITY_ALIASES: Record<string, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  'super rare': 'Super rare',
  'super-rare': 'Super rare',
  legendary: 'Legendary',
  epic: 'Epic',
  iconic: 'Iconic',
  enchanted: 'Enchanted',
  promo: 'Promo',
};

function canonicalRarity(input: string | null | undefined): string | null {
  if (!input) return null;
  return RARITY_ALIASES[input.trim().toLowerCase()] ?? null;
}

const CARD_TYPE_ALIASES: Record<string, string> = {
  character: 'CHARACTER',
  action: 'ACTION',
  item: 'ITEM',
  location: 'LOCATION',
  song: 'ACTION',   // Songs are Action cards in gamedata
};

function canonicalCardType(input: string | null | undefined): string | null {
  if (!input) return null;
  return CARD_TYPE_ALIASES[input.trim().toLowerCase()] ?? null;
}

export async function findCards(
  filters: FindFilters,
  currency: LorcanaCurrency = DEFAULT_CURRENCY,
): Promise<FindResult> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);

  const rarity = canonicalRarity(filters.rarity);
  const cardType = canonicalCardType(filters.cardType);
  const ink = filters.ink?.trim().toLowerCase() || null;
  const inkable = filters.inkable === 'true' ? true
                : filters.inkable === 'false' ? false
                : null;
  const q = filters.q?.trim() ?? null;

  // Set filter needs a lookup — /card-finder uses lowercase set codes.
  let setId: string | null = null;
  if (filters.set) {
    const { data } = await supabase
      .from('tcg_sets')
      .select('id')
      .eq('game_id', gameId)
      .eq('code', filters.set.toLowerCase())
      .maybeSingle();
    setId = (data as { id?: string } | null)?.id ?? null;
    if (!setId) return { tiles: [], totalMatched: 0, truncated: false, filters };
  }

  // Base card query with rarity + set filters pushed to Postgres for
  // efficiency; gamedata-driven filters (ink/inkable/cardType) run
  // client-side after fetch because gamedata is JSONB and needs
  // JSON-path filters that PostgREST expresses awkwardly.
  let cardsQ = supabase
    .from('tcg_cards')
    .select('id, name, set_id, collector_number, rarity, images, gamedata')
    .eq('game_id', gameId)
    .limit(CANDIDATE_TARGET);
  if (rarity) cardsQ = cardsQ.eq('rarity', rarity);
  if (setId) cardsQ = cardsQ.eq('set_id', setId);
  if (q && q.length >= 2) cardsQ = cardsQ.ilike('name', `%${q}%`);

  const { data: cardRows, error } = await cardsQ;
  if (error) return { tiles: [], totalMatched: 0, truncated: false, filters };
  let cards = (cardRows as TcgCard[] | null) ?? [];

  // In-memory filters against gamedata jsonb.
  if (ink) {
    cards = cards.filter((c) => {
      const gd = c.gamedata as Record<string, unknown> | null;
      return String(gd?.['ink'] ?? '').toLowerCase() === ink;
    });
  }
  if (cardType) {
    cards = cards.filter((c) => {
      const gd = c.gamedata as Record<string, unknown> | null;
      return String(gd?.['cardType'] ?? '').toUpperCase() === cardType;
    });
  }
  if (inkable != null) {
    cards = cards.filter((c) => {
      const gd = c.gamedata as Record<string, unknown> | null;
      return gd?.['inkable'] === inkable;
    });
  }

  const totalMatched = cards.length;
  const truncated = totalMatched >= CANDIDATE_TARGET;

  // Delegate pricing to getPricedTiles by feeding it the same filter
  // set — we already have candidate cards but this keeps the pricing
  // pipeline in one place. Currency scopes the source retail feed so
  // ranking is native, never FX-converted.
  const tiles = await getPricedTiles({
    limit: MAX_RESULTS,
    cardCandidates: Math.max(200, totalMatched),
    currency,
    ...(rarity ? { rarity } : {}),
    ...(setId ? { setId } : {}),
    ...(ink ? { ink } : {}),
  });

  // Apply cardType + inkable + name query on the tiles too (getPricedTiles
  // doesn't know those filters yet).
  let filtered = tiles;
  if (cardType || inkable != null || (q && q.length >= 2)) {
    const setById = new Map(cards.map((c) => [c.id, c]));
    filtered = tiles.filter((t) => {
      const card = setById.get(t.cardId);
      if (!card) return false;
      if (cardType) {
        const gd = card.gamedata as Record<string, unknown> | null;
        if (String(gd?.['cardType'] ?? '').toUpperCase() !== cardType) return false;
      }
      if (inkable != null) {
        const gd = card.gamedata as Record<string, unknown> | null;
        if (gd?.['inkable'] !== inkable) return false;
      }
      if (q && q.length >= 2 && !card.name.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }

  // Price min/max applied on the currency-matched tile price. Tiles
  // that aren't priced in the selected currency simply don't exist
  // here (already filtered upstream), so no silent fallback.
  const priceMin = typeof filters.priceMin === 'number' && Number.isFinite(filters.priceMin)
    ? filters.priceMin
    : null;
  const priceMax = typeof filters.priceMax === 'number' && Number.isFinite(filters.priceMax)
    ? filters.priceMax
    : null;
  if (priceMin != null || priceMax != null) {
    filtered = filtered.filter((t) => {
      if (priceMin != null && t.priceUsd < priceMin) return false;
      if (priceMax != null && t.priceUsd > priceMax) return false;
      return true;
    });
  }

  // Sort override
  switch (filters.sort) {
    case 'price-asc':
      filtered = [...filtered].sort((a, b) => a.priceUsd - b.priceUsd);
      break;
    case 'name-asc':
      filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'price-desc':
    default:
      filtered = [...filtered].sort((a, b) => b.priceUsd - a.priceUsd);
      break;
  }

  return {
    tiles: filtered.slice(0, MAX_RESULTS),
    totalMatched,
    truncated,
    filters: {
      ink: ink,
      rarity,
      cardType: filters.cardType?.trim() ?? null,
      inkable: filters.inkable ?? null,
      set: filters.set?.toLowerCase() ?? null,
      q,
      sort: filters.sort ?? 'price-desc',
      priceMin,
      priceMax,
    },
  };
}
