import type { SupabaseClient } from '@supabase/supabase-js';
import type { TcgCard, TcgSet } from './types';

// Discovery queries used by homepage + search surfaces. Game-agnostic;
// callers pass game_id. No YGO/MTG/Pokémon semantics here.

export async function getRecentSets(
  supabase: SupabaseClient,
  gameId: string,
  limit = 8,
): Promise<TcgSet[]> {
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .eq('game_id', gameId)
    .not('released_at', 'is', null)
    .order('released_at', { ascending: false })
    .limit(limit);
  if (error) {
    throw new Error(
      `[@collector-network/database] getRecentSets(${gameId}): ${error.message}`,
    );
  }
  return (data as TcgSet[] | null) ?? [];
}

export async function countCardsInSet(
  supabase: SupabaseClient,
  setId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('tcg_cards')
    .select('id', { count: 'exact', head: true })
    .eq('set_id', setId);
  if (error) {
    throw new Error(
      `[@collector-network/database] countCardsInSet(${setId}): ${error.message}`,
    );
  }
  return count ?? 0;
}

// Cards matching a rarity string. Case-sensitive to match how the DB
// stores rarities (see docs/yugioh/data-audit.md §6).
export async function getCardsByRarity(
  supabase: SupabaseClient,
  gameId: string,
  rarity: string,
  limit = 24,
): Promise<TcgCard[]> {
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .eq('rarity', rarity)
    .limit(limit);
  if (error) {
    throw new Error(
      `[@collector-network/database] getCardsByRarity(${gameId}, ${rarity}): ${error.message}`,
    );
  }
  return (data as TcgCard[] | null) ?? [];
}

// Prefix-based suggestion query. Deliberately uses btree-friendly
// `ilike '<q>%'` rather than `%<q>%` so the query stays fast until
// pg_trgm is applied upstream (see docs/yugioh/data-ingestion-plan.md I1).
export interface CardSuggestion {
  id: string;
  name: string;
  collector_number: string | null;
  rarity: string | null;
  set_id: string;
}

export async function getCardSuggestionsByPrefix(
  supabase: SupabaseClient,
  gameId: string,
  prefix: string,
  limit = 8,
): Promise<CardSuggestion[]> {
  const cleaned = prefix.trim();
  if (cleaned.length === 0) return [];
  const escaped = cleaned.replace(/[%_]/g, (m) => `\\${m}`);
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('id,name,collector_number,rarity,set_id')
    .eq('game_id', gameId)
    .ilike('name', `${escaped}%`)
    .limit(limit * 4); // fetch more than we need so we can de-duplicate by name
  if (error) {
    throw new Error(
      `[@collector-network/database] getCardSuggestionsByPrefix(${gameId}, ${prefix}): ${error.message}`,
    );
  }
  return (data as CardSuggestion[] | null) ?? [];
}

// Full substring name search — for the /search page. Slower than the
// prefix path until pg_trgm lands. Callers should surface the latency
// honestly in the UI.
//
// Whitespace runs become `%` wildcards so queries like `blue eye`
// match `Blue-Eyes White Dragon` (the dash character otherwise breaks
// literal ilike matching).
export async function searchCardsByName(
  supabase: SupabaseClient,
  gameId: string,
  query: string,
  limit = 200,
): Promise<TcgCard[]> {
  const cleaned = query.trim();
  if (cleaned.length === 0) return [];
  const escaped = cleaned.replace(/[%_]/g, (m) => `\\${m}`);
  const pattern = `%${escaped.replace(/\s+/g, '%')}%`;
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .ilike('name', pattern)
    .limit(limit);
  if (error) {
    throw new Error(
      `[@collector-network/database] searchCardsByName(${gameId}, ${query}): ${error.message}`,
    );
  }
  return (data as TcgCard[] | null) ?? [];
}

// Archetype filter over the game-agnostic `gamedata.archetypes` array.
// PostgREST array-contains: `?gamedata->archetypes=cs.{"X"}`.
export async function getCardsByArchetype(
  supabase: SupabaseClient,
  gameId: string,
  archetype: string,
  limit = 200,
): Promise<TcgCard[]> {
  const cleaned = archetype.trim();
  if (cleaned.length === 0) return [];
  // Build the JSON-array-contains filter payload. Supabase-js expects
  // the object; it stringifies internally for `.contains()`.
  const { data, error } = await supabase
    .from('tcg_cards')
    .select('*')
    .eq('game_id', gameId)
    .contains('gamedata', { archetypes: [cleaned] })
    .limit(limit);
  if (error) {
    throw new Error(
      `[@collector-network/database] getCardsByArchetype(${gameId}, ${archetype}): ${error.message}`,
    );
  }
  return (data as TcgCard[] | null) ?? [];
}
