import 'server-only';
import {
  countCardsAndUniqueInSets,
  getCardsBySet,
  getSetByCodeInsensitive,
  listAllSets,
  type TcgCard,
  type TcgSet,
} from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';

// Set-directory and set-detail composition helpers.
//
// listAllSets returns every set for the game. On top of that we layer
// per-set variant / unique-name counts so directory pages don't need a
// separate query for each set (which is fatal on games with 60+ sets).

export interface LcSetSummary {
  set: TcgSet;
  variantCount: number;
  uniqueCardCount: number;
}

export async function listSetsWithCounts(): Promise<LcSetSummary[]> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);
  const sets = await listAllSets(supabase, gameId);
  const setIds = sets.map((s) => s.id);
  const counts = await countCardsAndUniqueInSets(supabase, setIds);
  return sets
    .map((set) => ({
      set,
      variantCount: counts.get(set.id)?.variantCount ?? 0,
      uniqueCardCount: counts.get(set.id)?.uniqueCardCount ?? 0,
    }))
    .sort(byReleaseDateDesc);
}

/** Same as listSetsWithCounts but limited to the N most recent. Used
 *  by the homepage. */
export async function listRecentSetsWithCounts(limit = 8): Promise<LcSetSummary[]> {
  const all = await listSetsWithCounts();
  return all.slice(0, limit);
}

export async function getSetBundle(code: string): Promise<LcSetBundle | null> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);
  const set = await getSetByCodeInsensitive(supabase, gameId, code);
  if (!set) return null;
  const cards = await getCardsBySet(supabase, set.id);
  return { set, cards };
}

export interface LcSetBundle {
  set: TcgSet;
  cards: TcgCard[];
}

function byReleaseDateDesc(a: LcSetSummary, b: LcSetSummary): number {
  const ad = a.set.released_at ? Date.parse(a.set.released_at) : 0;
  const bd = b.set.released_at ? Date.parse(b.set.released_at) : 0;
  if (bd !== ad) return bd - ad;
  return a.set.name.localeCompare(b.set.name);
}
