import { unstable_cache } from 'next/cache';
import { CACHE_TAGS, CACHE_TTL, withCacheBypass } from './cache';
import { getYugiohClient } from './read';
import { safe } from './safe';

// Per-source freshness inspector for the YGOPrices UI. Reads the
// newest `updated_at` in tcg_market_prices_current for a specific
// (game_id, source) pair — that column is the price provider's own
// claim of when the number last moved. Ignoring it and displaying
// a frozen number as current is exactly what /api/admin/health/
// pricing-freshness flagged on 2026-09-30 for ygo/tcggraph.tcgplayer,
// which is why this helper exists.
//
// The 48h threshold matches SOURCE_STALE_HOURS in
// src/lib/health/pricing-freshness.ts on the mtgprices-web side, so
// the UI's "stale" verdict never disagrees with the operational
// health probe.

export const SOURCE_STALE_HOURS = 48;

const YGO_GAME_ID = 'ygo';

export type YugiohRetailSource =
  | 'tcggraph.tcgplayer'
  | 'tcggraph.cardmarket';

export interface SourceFreshness {
  source: YugiohRetailSource;
  newestUpdatedAt: string | null;
  ageHours: number | null;
  isStale: boolean;
}

async function _getYugiohSourceFreshness(
  source: YugiohRetailSource,
): Promise<SourceFreshness> {
  const supabase = getYugiohClient();
  const result = await safe(`source-freshness:${source}`, async () => {
    const { data, error } = await supabase
      .from('tcg_market_prices_current')
      .select('updated_at')
      .eq('game_id', YGO_GAME_ID)
      .eq('source', source)
      .order('updated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(
        `[yugioh/source-freshness] ${source}: ${error.message}`,
      );
    }
    return (data as { updated_at: string | null } | null)?.updated_at ?? null;
  });
  const iso = result.ok ? result.value : null;
  const ageHours = iso
    ? (Date.now() - Date.parse(iso)) / (1000 * 60 * 60)
    : null;
  const isStale =
    ageHours != null && ageHours > SOURCE_STALE_HOURS;
  return {
    source,
    newestUpdatedAt: iso,
    ageHours,
    isStale,
  };
}

//  Cache the freshness read per source with a short TTL. The value
//  moves at most once every few hours in normal operation; caching
//  keeps the header/tile/card-page checks free.
export const getYugiohSourceFreshness = withCacheBypass(
  _getYugiohSourceFreshness,
  unstable_cache(
    _getYugiohSourceFreshness,
    ['ygo:sourceFreshness', 'v1'],
    { revalidate: CACHE_TTL.MARKET_SHORT, tags: [CACHE_TAGS.MARKET] },
  ),
);

//  Short, honest label suitable for a compact banner. Formatted from
//  the source's own timestamp — never fabricated. Returns null when
//  the source is fresh so callers can safely `.filter(Boolean)` /
//  conditionally render.
export function staleSourceLabel(freshness: SourceFreshness): string | null {
  if (!freshness.isStale || !freshness.newestUpdatedAt) return null;
  const date = new Date(freshness.newestUpdatedAt);
  const displayDate = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
  const marketplace =
    freshness.source === 'tcggraph.tcgplayer' ? 'TCGPlayer' : 'Cardmarket';
  return `${marketplace} prices are temporarily stale. Last source update: ${displayDate}.`;
}
