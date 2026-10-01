import 'server-only';
import { unstable_cache } from 'next/cache';
import {
  countCardsAndUniqueInSets,
  getCardsBySet,
  getSetByCodeInsensitive,
  listAllSets,
  type TcgCard,
  type TcgSet,
} from '@collector-network/database';
import { getLorcanaClient, getLorcanaGameId } from './client';

const LORCANA_GAME_ID = 'lorcana';

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

async function _listSetsWithCounts(): Promise<LcSetSummary[]> {
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

// Perf (2026-10-01): set directory + per-set card counts are stable
// taxonomy data — only churn on new-set-day. unstable_cache so
// homepage, /browse and other callers share one warm result instead
// of each paying for a full listAllSets + countCardsAndUniqueInSets
// scan. Tagged `lorcana:taxonomy` so set ingest can revalidate it.
export const listSetsWithCounts = unstable_cache(
  _listSetsWithCounts,
  ['lorcana:sets:with-counts', 'v1'],
  { revalidate: 3_600, tags: ['lorcana:taxonomy'] },
);

/** Same as listSetsWithCounts but limited to the N most recent. Used
 *  by the homepage. */
export async function listRecentSetsWithCounts(limit = 8): Promise<LcSetSummary[]> {
  const all = await listSetsWithCounts();
  return all.slice(0, limit);
}

/** Map of `set_id → tcg_card_id[]` for every Lorcana set. Used by
 *  the signed-in set-index completion math — the browse page can
 *  intersect this with the user's owned-card-id set in memory
 *  rather than firing one query per set. Cached under the shared
 *  taxonomy tag so new-set ingests invalidate it with everything
 *  else. */
async function _listCardIdsBySet(): Promise<Record<string, string[]>> {
  const sb = getLorcanaClient();
  const CHUNK = 1000;
  const out: Record<string, string[]> = {};
  for (let from = 0; from < 60_000; from += CHUNK) {
    const { data, error } = await sb
      .from('tcg_cards')
      .select('id, set_id')
      .eq('game_id', LORCANA_GAME_ID)
      .range(from, from + CHUNK - 1);
    if (error) throw new Error(`[lorcana/browse] cards-by-set: ${error.message}`);
    const rows = (data as Array<{ id: string; set_id: string }> | null) ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      (out[row.set_id] ??= []).push(row.id);
    }
    if (rows.length < CHUNK) break;
  }
  return out;
}

export const listCardIdsBySet = unstable_cache(
  _listCardIdsBySet,
  ['lorcana:cards:by-set', 'v1'],
  { revalidate: 21_600, tags: ['lorcana:taxonomy'] },
);

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
