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
// their empty states rather than a runtime crash. Production always has
// the env set on the Vercel project, so this branch is a dev / preview
// safety net, not a data path.

let sharedClient: SupabaseClient | null = null;

export function getOnepieceClient(): SupabaseClient {
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

// A minimal PostgREST-shaped stub. Emulates the .from().select().eq(…)
// chain against `preview-fixture` so every page renders with plausible
// sample data. Downstream code already handles empty rows / null
// maybeSingle results so consumers don't know this is a stub.
//
// Only fires when SUPABASE_URL is absent — production always has the
// real client. This is dev / preview only.
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
          // Passive filters — accepted but do not narrow the fixture.
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

// Canonical identifiers.
//
// The cross-site `@collector-network/network-config` vocabulary calls
// this game "onepiece" (unhyphenated) — that's the URL / routing token.
// The production tcg_games row uses id="onepiece" and slug="one-piece"
// (hyphenated). Verified 2026-09-26 via apps/onepiece/scripts/probe-games.mts.
// Every downstream tcg_*.game_id column is "onepiece" without the hyphen.
export const ONEPIECE_GAME_SLUG = 'one-piece' as const;

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

  // OP's canonical tcg_games row uses id="onepiece" and slug="onepiece"
  // (unlike Yu-Gi-Oh, whose slug is "yugioh" but id is the abbreviation
  // "ygo"). Verified against production in docs/onepiece/data-audit.md
  // and cross-referenced from docs/yugioh/data-audit.md §3. If the row
  // is missing (unlikely — the row is present in prod), fall through to
  // the same value so downstream queries return empty rather than crash.
  const resolved = (data as { id?: string } | null)?.id ?? 'onepiece';
  cachedGameId = resolved;
  return resolved;
}

// Test-only escape hatch for the rare integration test that needs to
// reset the cache between runs.
export function _resetGameIdCacheForTests(): void {
  cachedGameId = null;
}
