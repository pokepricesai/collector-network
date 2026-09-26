import 'server-only';
import {
  createTcgClient,
  type SupabaseClient,
} from '@collector-network/database';
import { getFixtureRows } from './preview-fixture';

// Single shared Supabase client. Anonymous access is enough — every
// table this app reads is public. This is a per-process cache so we
// don't reconnect on every server component render.
//
// Never call this from a client component. `server-only` throws at
// build time if anyone tries.
//
// When the SUPABASE_URL / SUPABASE_ANON_KEY env is absent (local dev
// without secrets; a first-look preview deploy) we return a stub client
// that resolves every query to an empty result set. Pages then render
// their empty states rather than a runtime crash.

let sharedClient: SupabaseClient | null = null;

export function getLorcanaClient(): SupabaseClient {
  if (sharedClient) return sharedClient;
  if (
    !process.env['SUPABASE_URL'] ||
    !process.env['SUPABASE_ANON_KEY']
  ) {
    sharedClient = createStubClient();
    return sharedClient;
  }
  sharedClient = createTcgClient();
  return sharedClient;
}

function createStubClient(): SupabaseClient {
  interface BuilderState {
    table: string;
    filters: Record<string, unknown>;
    headOnly: boolean;
  }

  function makeBuilder(table: string): unknown {
    const state: BuilderState = { table, filters: {}, headOnly: false };

    function resolveRows(): unknown[] {
      return getFixtureRows(state.table, state.filters);
    }

    function payload(): { data: unknown[] | null; error: null; count: number } {
      const rows = resolveRows();
      if (state.headOnly) return { data: null, error: null, count: rows.length };
      return { data: rows, error: null, count: rows.length };
    }

    const target = function () {
      /* proxy target */
    };
    const proxy: unknown = new Proxy(target, {
      get(_t, prop) {
        if (prop === 'then') {
          const p = payload();
          return (resolve: (v: typeof p) => unknown) =>
            Promise.resolve(p).then(resolve);
        }
        switch (prop) {
          case 'select':
            return (_cols?: string, opts?: { count?: string; head?: boolean }) => {
              if (opts?.head) state.headOnly = true;
              return proxy;
            };
          case 'eq':
            return (col: string, value: unknown) => {
              state.filters[col] = value;
              return proxy;
            };
          case 'in':
            return (col: string, values: unknown[]) => {
              state.filters[`${col}_in`] = values;
              return proxy;
            };
          case 'ilike':
            return (col: string, pattern: string) => {
              state.filters[`${col}_like`] = pattern;
              return proxy;
            };
          case 'maybeSingle':
            return () => {
              const rows = resolveRows();
              return Promise.resolve({
                data: rows.length > 0 ? rows[0] : null,
                error: null,
              });
            };
          case 'single':
            return () => {
              const rows = resolveRows();
              return Promise.resolve({
                data: rows[0] ?? null,
                error: rows.length === 0 ? { message: 'no rows' } : null,
              });
            };
          case 'neq':
          case 'gt':
          case 'gte':
          case 'lt':
          case 'lte':
          case 'is':
          case 'not':
          case 'like':
          case 'contains':
          case 'or':
          case 'match':
          case 'filter':
          case 'order':
          case 'limit':
          case 'range':
          case 'returns':
            return () => proxy;
          default:
            return () => proxy;
        }
      },
    });
    return proxy;
  }

  return {
    from: (table: string) => makeBuilder(table),
  } as unknown as SupabaseClient;
}

// Canonical identifiers. Verified 2026-09-26 via
// apps/lorcana/scripts/probe-games.mts:
//   tcg_games row → id='lorcana', slug='disney-lorcana', name='Disney Lorcana'.
// Every downstream tcg_*.game_id column is 'lorcana'.
export const LORCANA_GAME_SLUG = 'disney-lorcana' as const;
export const LORCANA_GAME_ID = 'lorcana' as const;

let cachedGameId: string | null = null;

/** Resolve the game_id from tcg_games. Cheap; result is process-cached. */
export async function getLorcanaGameId(
  supabase: SupabaseClient = getLorcanaClient(),
): Promise<string> {
  if (cachedGameId) return cachedGameId;

  const { data, error } = await supabase
    .from('tcg_games')
    .select('id')
    .eq('slug', LORCANA_GAME_SLUG)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[apps/lorcana] getLorcanaGameId(${LORCANA_GAME_SLUG}): ${error.message}`,
    );
  }

  const resolved = (data as { id?: string } | null)?.id ?? LORCANA_GAME_ID;
  cachedGameId = resolved;
  return resolved;
}

export function _resetGameIdCacheForTests(): void {
  cachedGameId = null;
}
