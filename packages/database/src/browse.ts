import type { SupabaseClient } from '@supabase/supabase-js';
import type { TcgCard, TcgSet } from './types';

// Browse-directory queries. Game-agnostic. Use range-based paging so
// Supabase's default 1000-row cap doesn't silently truncate results
// and long queries don't hit statement timeouts.

const PAGE_SIZE = 1000;

// Fetch every set for a game. Sorted by release date desc (nulls last)
// so directory pages get a sensible default order. Only ~1000 sets per
// game today so a single query is enough.
export async function listAllSets(
  supabase: SupabaseClient,
  gameId: string,
): Promise<TcgSet[]> {
  const sets: TcgSet[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_sets')
      .select('*')
      .eq('game_id', gameId)
      .range(from, to);
    if (error) {
      throw new Error(`[@collector-network/database] listAllSets(${gameId}): ${error.message}`);
    }
    const rows = (data as TcgSet[] | null) ?? [];
    sets.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return sets;
}

// Look up a set by its code (case-insensitive). Set codes are unique
// per game.
export async function getSetByCodeInsensitive(
  supabase: SupabaseClient,
  gameId: string,
  code: string,
): Promise<TcgSet | null> {
  const normalised = code.trim().toLowerCase();
  const { data, error } = await supabase
    .from('tcg_sets')
    .select('*')
    .eq('game_id', gameId)
    .ilike('code', normalised)
    .maybeSingle();
  if (error) {
    throw new Error(
      `[@collector-network/database] getSetByCodeInsensitive(${gameId}, ${code}): ${error.message}`,
    );
  }
  return (data as TcgSet | null) ?? null;
}

// Cards belonging to a set. Batched paginated fetch so large sets
// (100+ cards) come back in one call.
export async function getCardsBySet(
  supabase: SupabaseClient,
  setId: string,
): Promise<TcgCard[]> {
  const cards: TcgCard[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('*')
      .eq('set_id', setId)
      .range(from, to);
    if (error) {
      throw new Error(
        `[@collector-network/database] getCardsBySet(${setId}): ${error.message}`,
      );
    }
    const rows = (data as TcgCard[] | null) ?? [];
    cards.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return cards;
}

// Cards for many sets in one call. Used by set-directory listings that
// need a per-set card count without a query per set.
export async function countCardsInSets(
  supabase: SupabaseClient,
  setIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of setIds) counts.set(id, 0);
  if (setIds.length === 0) return counts;
  // Paginate through the tcg_cards rows scoped to the set IDs.
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('set_id')
      .in('set_id', [...setIds])
      .range(from, to);
    if (error) {
      throw new Error(
        `[@collector-network/database] countCardsInSets: ${error.message}`,
      );
    }
    const rows = (data as Array<{ set_id: string }> | null) ?? [];
    for (const r of rows) {
      counts.set(r.set_id, (counts.get(r.set_id) ?? 0) + 1);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return counts;
}

export interface SetCardCounts {
  variantCount: number; // total tcg_cards rows in the set (per-rarity)
  uniqueCardCount: number; // distinct card names
}

// Same as countCardsInSets but returns both the raw variant count and
// the distinct-name count per set. A single card printed at multiple
// rarities within the same set becomes multiple tcg_cards rows;
// collectors typically want to see both numbers (e.g. "LOB — 126
// variants across 111 unique cards").
export async function countCardsAndUniqueInSets(
  supabase: SupabaseClient,
  setIds: readonly string[],
): Promise<Map<string, SetCardCounts>> {
  const counts = new Map<string, SetCardCounts>();
  const nameSets = new Map<string, Set<string>>();
  for (const id of setIds) {
    counts.set(id, { variantCount: 0, uniqueCardCount: 0 });
    nameSets.set(id, new Set());
  }
  if (setIds.length === 0) return counts;
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('set_id,name')
      .in('set_id', [...setIds])
      .range(from, to);
    if (error) {
      throw new Error(
        `[@collector-network/database] countCardsAndUniqueInSets: ${error.message}`,
      );
    }
    const rows = (data as Array<{ set_id: string; name: string }> | null) ?? [];
    for (const r of rows) {
      const c = counts.get(r.set_id);
      if (c) c.variantCount += 1;
      nameSets.get(r.set_id)?.add(r.name);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  for (const [id, names] of nameSets) {
    const c = counts.get(id);
    if (c) c.uniqueCardCount = names.size;
  }
  return counts;
}

// Distinct name+gamedata rows across the whole game — used by the
// archetype directory to enumerate every archetype tag.
export interface ArchetypeIndexEntry {
  cardId: string;
  cardName: string;
  archetypes: string[];
}

export async function listAllArchetypeEntries(
  supabase: SupabaseClient,
  gameId: string,
): Promise<ArchetypeIndexEntry[]> {
  const out: ArchetypeIndexEntry[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('id,name,gamedata')
      .eq('game_id', gameId)
      .range(from, to);
    if (error) {
      throw new Error(
        `[@collector-network/database] listAllArchetypeEntries(${gameId}): ${error.message}`,
      );
    }
    const rows =
      (data as Array<{
        id: string;
        name: string;
        gamedata: Record<string, unknown> | null;
      }> | null) ?? [];
    for (const r of rows) {
      const arcs = (r.gamedata?.['archetypes'] as string[] | undefined) ?? [];
      if (arcs.length === 0) continue;
      out.push({ cardId: r.id, cardName: r.name, archetypes: arcs });
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// Distinct rarity values with counts for a game — used by the rarity
// directory page.
export async function getRarityCounts(
  supabase: SupabaseClient,
  gameId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('rarity')
      .eq('game_id', gameId)
      .not('rarity', 'is', null)
      .range(from, to);
    if (error) {
      throw new Error(
        `[@collector-network/database] getRarityCounts(${gameId}): ${error.message}`,
      );
    }
    const rows = (data as Array<{ rarity: string | null }> | null) ?? [];
    for (const r of rows) {
      if (!r.rarity) continue;
      counts.set(r.rarity, (counts.get(r.rarity) ?? 0) + 1);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return counts;
}
