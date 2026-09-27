import 'server-only';
import { listRecentSetsWithCounts, type LcSetSummary } from './browse';
import { getPricedTiles, type DiscoveryTile } from './discovery';
import { getLorcanaClient, getLorcanaGameId } from './client';

// Homepage payload assembly.
//
// Movers deliberately absent: docs/lorcana/data-audit.md §D shows
// only 6 days of daily retail history. Any window-over-window "% up"
// figure would be dishonest, so we defer movers until the window
// reaches 30 days and instead surface real value-ordered boards:
//   * most valuable cards network-wide
//   * Enchanted spotlight
//   * Iconic spotlight (Sets 9+)
//
// Every fetch is Promise.allSettled and degrades to an empty result
// on failure; the page must never crash because one query 500'd.

export interface HomepageStats {
  cardCount: number;
  setCount: number;
  enchantedCount: number;
}

export interface HomepagePayload {
  stats: HomepageStats;
  latestSets: LcSetSummary[];
  mostValuable: DiscoveryTile[];
  enchantedSpotlight: DiscoveryTile[];
  iconicSpotlight: DiscoveryTile[];
  errors: string[];
}

export async function getHomepageData(): Promise<HomepagePayload> {
  const errors: string[] = [];

  const [statsR, setsR, valueR, enchR, iconR] = await Promise.allSettled([
    getHomepageStats(),
    listRecentSetsWithCounts(6),
    getPricedTiles({ limit: 12, cardCandidates: 500 }),
    getPricedTiles({ limit: 6, rarity: 'Enchanted', cardCandidates: 260 }),
    getPricedTiles({ limit: 4, rarity: 'Iconic', cardCandidates: 30 }),
  ]);

  const stats = statsR.status === 'fulfilled'
    ? statsR.value
    : (errors.push('stats: ' + describe(statsR.reason)),
       { cardCount: 0, setCount: 0, enchantedCount: 0 });

  const latestSets = setsR.status === 'fulfilled'
    ? setsR.value
    : (errors.push('latestSets: ' + describe(setsR.reason)), []);

  const mostValuable = valueR.status === 'fulfilled'
    ? valueR.value
    : (errors.push('mostValuable: ' + describe(valueR.reason)), []);

  const enchantedSpotlight = enchR.status === 'fulfilled'
    ? enchR.value
    : (errors.push('enchantedSpotlight: ' + describe(enchR.reason)), []);

  const iconicSpotlight = iconR.status === 'fulfilled'
    ? iconR.value
    : (errors.push('iconicSpotlight: ' + describe(iconR.reason)), []);

  return {
    stats,
    latestSets,
    mostValuable,
    enchantedSpotlight,
    iconicSpotlight,
    errors,
  };
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function getHomepageStats(): Promise<HomepageStats> {
  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);

  const [cardsCount, setsCount, enchCount] = await Promise.all([
    countRows(supabase, 'tcg_cards', gameId),
    countRows(supabase, 'tcg_sets', gameId),
    countRarity(supabase, gameId, 'Enchanted'),
  ]);

  return {
    cardCount: cardsCount,
    setCount: setsCount,
    enchantedCount: enchCount,
  };
}

async function countRows(
  supabase: ReturnType<typeof getLorcanaClient>,
  table: string,
  gameId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('game_id', { count: 'exact', head: true })
    .eq('game_id', gameId);
  if (error) throw new Error(`[lorcana] countRows(${table}): ${error.message}`);
  return count ?? 0;
}

async function countRarity(
  supabase: ReturnType<typeof getLorcanaClient>,
  gameId: string,
  rarity: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('tcg_cards')
    .select('game_id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .eq('rarity', rarity);
  if (error) throw new Error(`[lorcana] countRarity(${rarity}): ${error.message}`);
  return count ?? 0;
}
