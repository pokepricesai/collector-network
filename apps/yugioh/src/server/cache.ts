// Cache TTLs (in seconds) for the Yu-Gi-Oh! composition layer.
//
// Data class → TTL rationale:
//
//   TAXONOMY_LONG  · 21600 (6h)
//     Slow-moving catalogue identity: the set / rarity / archetype
//     directories. New sets ship on a rough monthly cadence; a 6-hour
//     lag is well below the human noticeable window for these pages.
//     Directory rebuilds are the single most expensive scans in the
//     product (10-15s cold), so caching them aggressively is the
//     highest-value change in Slice 9.
//
//   ENTITY_MEDIUM  · 1800 (30m)
//     Per-slug composition: /set/[code], /rarity/[family],
//     /archetype/[slug]. These embed pricing, so we bound staleness at
//     30 minutes to keep prices from drifting far from the pricing
//     helper's own refresh cadence.
//
//   MARKET_SHORT   · 900 (15m)
//     Market rankings and F&L pricing overlay. Matches the page-level
//     ISR revalidate we already set. Rankings are pure functions of
//     current-price rows, so caching at the read-model layer lets
//     concurrent requests share the same computation.
//
//   FNL_HOURLY     · 3600 (1h)
//     F&L composition: identity (which cards are restricted) is slow-
//     moving; new banlist announcements land in the shared data source
//     every few months. Best-USD pricing overlay lives inside the same
//     cached value — acceptable staleness given the page is a browsing
//     surface, not a checkout screen.
//
//   SITEMAP_DAILY  · 86400 (24h)
//     Sitemap route inventories: card slugs, printing routes, set
//     codes. Google typically re-crawls sitemaps on the order of hours
//     to days; 24 hours gives us headroom without materially delaying
//     visibility of new URLs.
//
// unstable_cache from next/cache is the primitive. It intentionally
// caches only successful resolutions — a thrown error will not
// poison the cache and the next request will re-run the function.
// This matches our fail-soft pattern: if a composition helper throws,
// safe() wraps it into a degraded response instead of a cached bad
// value.

export const CACHE_TTL = {
  TAXONOMY_LONG: 21_600,
  ENTITY_MEDIUM: 1_800,
  MARKET_SHORT: 900,
  FNL_HOURLY: 3_600,
  SITEMAP_DAILY: 86_400,
} as const;

// Cache tags let us invalidate whole classes at once if we ever wire
// a manual purge endpoint. Kept centralised so tag typos surface at
// compile time.
export const CACHE_TAGS = {
  TAXONOMY: 'ygo:taxonomy',
  ENTITY: 'ygo:entity',
  MARKET: 'ygo:market',
  FNL: 'ygo:fnl',
  SITEMAP: 'ygo:sitemap',
  CARD: 'ygo:card',
} as const;

// Cache-bypass switch. Set BYPASS_YGO_CACHE=1 in the environment to
// force every wrapped helper to call its uncached implementation
// directly. This exists for verification scripts run outside a Next
// request context — unstable_cache throws in that setting. Production
// never sets this flag.
export const CACHE_BYPASS = process.env['BYPASS_YGO_CACHE'] === '1';

// Convenience: pick between a cached wrapper and its raw impl based on
// the bypass flag. Preserves the original function signature.
export function withCacheBypass<F extends (...args: never[]) => Promise<unknown>>(
  raw: F,
  cached: F,
): F {
  return (CACHE_BYPASS ? raw : cached) as F;
}
