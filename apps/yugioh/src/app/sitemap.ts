import type { MetadataRoute } from 'next';
import {
  listAllCardSlugs,
  listAllPrintingRoutes,
} from '../server/card';

// Slice 6 sitemap: sharded across the homepage, cards, and printings.
// Next.js generates a sitemap index at /sitemap.xml that references the
// shards; each shard is served at /sitemap/[id].xml.
//
// URL counts vs Google's 50k-per-file cap:
//   base       : ~1 URL
//   cards      : ~20-40k URLs (unique names)
//   printings-0: ~40k URLs
//   printings-1: ~40k URLs (if the tail is that long)
// If YGO grows past the caps we split further and update this file.
//
// Dynamic on-request generation. Slice 6 accepts a cold render cost
// on first request per shard and caches the response for 24 hours;
// Googlebot fetches these rarely so the total load stays low. Slice 9
// adds offline sitemap generation into object storage.

export const dynamic = 'force-dynamic';
export const revalidate = 86_400;

const SITE_URL =
  process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://duelistprices.example';

// Cap per shard. Google's spec is 50,000 URLs — we stay well under so
// there's headroom for the tail. During the initial production build
// we use a much lower cap so the first prerender (before revalidate
// kicks in) completes inside Supabase's statement timeout.
const SHARD_CAP_RUNTIME = 45_000;
const SHARD_CAP_BUILD = 2_500;
const SHARD_CAP =
  process.env['NEXT_PHASE'] === 'phase-production-build'
    ? SHARD_CAP_BUILD
    : SHARD_CAP_RUNTIME;

// Base "core surface" shard.
const BASE_URLS: MetadataRoute.Sitemap = [
  {
    url: `${SITE_URL}/`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 1.0,
  },
];

export async function generateSitemaps(): Promise<Array<{ id: string }>> {
  return [
    { id: 'base' },
    { id: 'cards' },
    { id: 'printings-0' },
    { id: 'printings-1' },
  ];
}

export default async function sitemap({
  id,
}: {
  id: string;
}): Promise<MetadataRoute.Sitemap> {
  // At build time, only the base shard is generated. Cards +
  // printings shards return empty during the build and are hydrated
  // on the first live request (then cached for 24h). This keeps the
  // production build free of Supabase timeouts and lets us update the
  // sitemap without a full redeploy.
  const isBuild = process.env['NEXT_PHASE'] === 'phase-production-build';
  if (id === 'base') return BASE_URLS;
  if (isBuild) return [];
  if (id === 'cards') return buildCardsSitemap();
  if (id === 'printings-0') return buildPrintingsSitemap(0);
  if (id === 'printings-1') return buildPrintingsSitemap(1);
  return [];
}

async function buildCardsSitemap(): Promise<MetadataRoute.Sitemap> {
  const seenSlugs = new Set<string>();
  const entries: MetadataRoute.Sitemap = [];
  let cursor: string | null = null;
  // De-dupe by slug across cursor pages. tcg_cards is per-rarity so
  // many rows share a name; a logical card URL is per unique name.
  while (entries.length < SHARD_CAP) {
    const { rows, nextCursor } = await listAllCardSlugs(undefined, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (seenSlugs.has(r.slug)) continue;
      seenSlugs.add(r.slug);
      entries.push({
        url: `${SITE_URL}/card/${r.slug}`,
        lastModified: r.updatedAt ? new Date(r.updatedAt) : undefined,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
      if (entries.length >= SHARD_CAP) break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return entries;
}

async function buildPrintingsSitemap(
  shard: 0 | 1,
): Promise<MetadataRoute.Sitemap> {
  // Simple 2-way partition by first character of the card slug. Coarse
  // but deterministic and Googlebot-safe. shard 0 = a-m, shard 1 = n-z
  // + digits.
  const entries: MetadataRoute.Sitemap = [];
  let cursor: string | null = null;
  while (entries.length < SHARD_CAP) {
    const { rows, nextCursor } = await listAllPrintingRoutes(undefined, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      const bucketChar = r.cardSlug.charAt(0).toLowerCase();
      const isEarly = bucketChar <= 'm';
      if ((shard === 0 && !isEarly) || (shard === 1 && isEarly)) continue;
      entries.push({
        url: `${SITE_URL}/card/${r.cardSlug}/printing/${encodeURIComponent(
          r.collectorNumber,
        )}/${encodeURIComponent(r.printingKey)}`,
        lastModified: r.updatedAt ? new Date(r.updatedAt) : undefined,
        changeFrequency: 'weekly',
        priority: 0.5,
      });
      if (entries.length >= SHARD_CAP) break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return entries;
}
