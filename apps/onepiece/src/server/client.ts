import 'server-only';
import {
  createTcgClient,
  type SupabaseClient,
} from '@collector-network/database';

// Single shared Supabase client. Anonymous access is enough — every
// table this app reads is public. This is a per-process cache so we
// don't reconnect on every server component render.
//
// Never call this from a client component. `server-only` throws at
// build time if anyone tries.

let sharedClient: SupabaseClient | null = null;

export function getOnepieceClient(): SupabaseClient {
  if (!sharedClient) sharedClient = createTcgClient();
  return sharedClient;
}

// Canonical identifiers.
//
// Slug (`onepiece`) is the value used by the cross-site
// @collector-network/network-config vocabulary. Game id (`op`) is the
// value stored in tcg_games.id and referenced by every tcg_*.game_id
// column. Both are cached at first lookup so we don't repeat the tcg_games
// round trip per request.
export const ONEPIECE_GAME_SLUG = 'onepiece' as const;

let cachedGameId: string | null = null;

/** Resolve the game_id from tcg_games. Cheap; result is process-cached. */
export async function getOnepieceGameId(
  supabase: SupabaseClient = getOnepieceClient(),
): Promise<string> {
  if (cachedGameId) return cachedGameId;

  const { data, error } = await supabase
    .from('tcg_games')
    .select('id')
    .eq('slug', ONEPIECE_GAME_SLUG)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[apps/onepiece] getOnepieceGameId(${ONEPIECE_GAME_SLUG}): ${error.message}`,
    );
  }

  // If the shared DB has not yet been seeded for One Piece, we fall
  // back to the abbreviation convention (matches how yugioh uses "ygo"
  // in tcg_games.id). Never crash the app — return the abbreviation
  // and let downstream queries return empty result sets.
  const resolved = (data as { id?: string } | null)?.id ?? 'op';
  cachedGameId = resolved;
  return resolved;
}

// Test-only escape hatch for the rare integration test that needs to
// reset the cache between runs.
export function _resetGameIdCacheForTests(): void {
  cachedGameId = null;
}
