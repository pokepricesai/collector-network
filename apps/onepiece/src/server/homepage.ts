import 'server-only';
import { listRecentSetsWithCounts, type OpSetSummary } from './browse';
import { getMovers, type MoverEntry } from './market';
import { getOnepieceClient, getOnepieceGameId } from './client';

// Homepage payload assembly.
//
// Every section is fetched in parallel and each degrades to an empty
// state on failure — the homepage must never crash because one
// Supabase call returned an error. This mirrors the yugioh homepage
// pattern.

export interface HomepageStats {
  cardCount: number;
  setCount: number;
  priceObservations: number;
}

export interface HomepagePayload {
  stats: HomepageStats;
  latestSets: OpSetSummary[];
  risers: MoverEntry[];
  fallers: MoverEntry[];
  errors: string[];
}

export async function getHomepageData(): Promise<HomepagePayload> {
  const errors: string[] = [];

  const [statsResult, latestResult, moversResult] = await Promise.allSettled([
    getHomepageStats(),
    listRecentSetsWithCounts(8),
    getMovers(30, 6),
  ]);

  const stats: HomepageStats =
    statsResult.status === 'fulfilled'
      ? statsResult.value
      : (errors.push('stats: ' + (statsResult.reason?.message ?? 'unknown')), {
          cardCount: 0,
          setCount: 0,
          priceObservations: 0,
        });

  const latestSets =
    latestResult.status === 'fulfilled'
      ? latestResult.value
      : (errors.push('latestSets: ' + (latestResult.reason?.message ?? 'unknown')), []);

  const movers =
    moversResult.status === 'fulfilled'
      ? moversResult.value
      : (errors.push('movers: ' + (moversResult.reason?.message ?? 'unknown')), {
          risers: [],
          fallers: [],
        });

  return {
    stats,
    latestSets,
    risers: movers.risers,
    fallers: movers.fallers,
    errors,
  };
}

async function getHomepageStats(): Promise<HomepageStats> {
  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);

  const [cardsCount, setsCount, pricesCount] = await Promise.all([
    countRows(supabase, 'tcg_cards', gameId),
    countRows(supabase, 'tcg_sets', gameId),
    countRows(supabase, 'tcg_market_prices_current', gameId),
  ]);

  return {
    cardCount: cardsCount,
    setCount: setsCount,
    priceObservations: pricesCount,
  };
}

async function countRows(
  supabase: ReturnType<typeof getOnepieceClient>,
  table: string,
  gameId: string,
): Promise<number> {
  // `game_id` exists on every counted table; `id` does not on the
  // current-price tables (composite PK). Select the column we actually
  // filter by so the count works uniformly across tcg_cards / tcg_sets
  // / tcg_market_prices_current.
  const { count, error } = await supabase
    .from(table)
    .select('game_id', { count: 'exact', head: true })
    .eq('game_id', gameId);
  if (error) {
    throw new Error(`[apps/onepiece] countRows(${table}): ${error.message}`);
  }
  return count ?? 0;
}
