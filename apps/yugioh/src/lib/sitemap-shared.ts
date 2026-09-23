// Shared sitemap constants + helpers. Used by both the sitemap-index
// route and the per-shard route so the two never drift.

export const SITEMAP_SHARDS = [
  'base',
  'cards',
  'printings-0',
  'printings-1',
  'printings-2',
] as const;

export type SitemapShard = (typeof SITEMAP_SHARDS)[number];

// Google's spec: 50,000 URLs / 50 MB uncompressed per sitemap file.
// We cap well below the URL limit to leave room for tail growth.
export const SITEMAP_URL_CAP = 45_000;
export const SITEMAP_BYTE_CAP = 50 * 1024 * 1024; // 50 MB

export const SITEMAP_CACHE_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=86400',
};

// Deterministic 3-way partition of the ~86k printings by first
// character of the card slug. Measured on 2026-09-23 production data
// gave a 2-way split of 52k / 34k which overflowed the 45k URL cap on
// the "early" bucket; switching to 3 slices delivers ≤ ~28k per shard
// with headroom for tail growth. Boundaries chosen from that
// measurement:
//   shard 0 → digits + a-c   (~24k urls)
//   shard 1 → d-m            (~28k urls)
//   shard 2 → n-z            (~34k urls)
// Adjust if any shard approaches the 45k cap after ingest growth.
export function printingShardForSlug(slug: string): 0 | 1 | 2 {
  const c = slug.charAt(0).toLowerCase();
  if (c >= 'n' && c <= 'z') return 2;
  if (c >= 'd' && c <= 'm') return 1;
  return 0;
}

export { siteUrl } from './site-url';

// Escape XML special chars in a URL. Applied to every <loc>.
export function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
