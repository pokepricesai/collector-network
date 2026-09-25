// Slice F — server-side card search for the deck builder.
//
// Identity-level results: one row per (card_key, English tcg_cards
// representative). Purpose-built for the builder — filters on name,
// frame type and archetype only. Full card-finder is available at
// /card-finder for browsing; the builder needs a fast typeahead.

import { unstable_cache } from 'next/cache';
import type { TcgCard } from '@collector-network/database';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';
import {
  normaliseCardKey,
  readFnlStatus,
  type FnlStatus,
} from '../lib/deck-identity';

export interface DeckSearchResult {
  card_key: string;
  card_name: string;
  image: string | null;
  frameType: string | null;
  fnlStatus: FnlStatus;
  atk: number | null;
  def: number | null;
  level: number | null;
  linkRating: number | null;
  attribute: string | null;
  race: string | null;
  archetypes: string[];
}

interface QueryOpts {
  text?: string;
  frame?: string;
  archetype?: string;
  extraOnly?: boolean;
  mainOnly?: boolean;
  limit?: number;
}

async function _search(opts: QueryOpts = {}): Promise<DeckSearchResult[]> {
  const supabase = getYugiohClient();
  const limit = Math.min(200, Math.max(1, opts.limit ?? 40));

  let query = supabase
    .from('tcg_cards')
    .select('id, name, images, gamedata, rarity')
    .eq('game_id', 'ygo')
    .eq('language', 'en');

  if (opts.text) {
    query = query.ilike('name', `%${opts.text.trim()}%`);
  }
  if (opts.frame) {
    query = query.filter('gamedata->>frameType', 'eq', opts.frame.toLowerCase());
  }
  if (opts.archetype) {
    query = query.contains('gamedata->archetypes', [opts.archetype]);
  }
  // Pull a generous slice so we can dedupe by identity in-memory
  // (we return `limit` distinct card families).
  const scanLimit = Math.min(2000, limit * 20);
  query = query.limit(scanLimit);

  const { data, error } = await query;
  if (error) throw new Error(`[yugioh/deck-search] ${error.message}`);
  const rows = (data as TcgCard[] | null) ?? [];

  const byKey = new Map<string, DeckSearchResult>();
  for (const c of rows) {
    const key = normaliseCardKey(c.name);
    if (byKey.has(key)) continue; // one representative per identity
    const gd = (c.gamedata ?? {}) as Record<string, unknown>;
    const frame = typeof gd['frameType'] === 'string' ? (gd['frameType'] as string).toLowerCase() : null;
    if (opts.extraOnly && !isExtraFrame(frame)) continue;
    if (opts.mainOnly && isExtraFrame(frame)) continue;
    byKey.set(key, {
      card_key: key,
      card_name: c.name,
      image: c.images?.small ?? c.images?.normal ?? c.images?.large ?? null,
      frameType: frame,
      fnlStatus: readFnlStatus(c.gamedata),
      atk: numOrNull(gd['atk']),
      def: numOrNull(gd['def']),
      level: numOrNull(gd['level']),
      linkRating: numOrNull(gd['linkRating']),
      attribute: strOrNull(gd['attribute']),
      race: strOrNull(gd['race']),
      archetypes: Array.isArray(gd['archetypes']) ? (gd['archetypes'] as string[]) : [],
    });
    if (byKey.size >= limit) break;
  }
  return [...byKey.values()].sort((a, b) => a.card_name.localeCompare(b.card_name));
}

function isExtraFrame(frame: string | null): boolean {
  return frame === 'fusion' || frame === 'synchro' || frame === 'xyz' || frame === 'link';
}
function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export const searchCardsForDeck = withCacheBypass(
  _search,
  unstable_cache(_search, ['ygo:deck-search', 'v1'], {
    revalidate: CACHE_TTL.TAXONOMY_LONG,
    tags: [CACHE_TAGS.CARD],
  }),
);
