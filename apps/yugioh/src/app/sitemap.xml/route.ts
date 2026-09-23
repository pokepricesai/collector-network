import { NextResponse } from 'next/server';
import {
  SITEMAP_CACHE_HEADERS,
  SITEMAP_SHARDS,
  siteUrl,
} from '../../lib/sitemap-shared';

// Sitemap-index served at the conventional URL. Points every crawler
// at the shard files under /sitemap/[shard].xml.
//
// We deliberately do NOT use Next's metadata `sitemap.ts` mechanic
// (which would return an empty urlset here) — route handlers give us
// full control of the sitemap-index XML shape.

export const dynamic = 'force-static';
export const revalidate = 86_400;

export function GET() {
  const url = siteUrl();
  const now = new Date().toISOString();
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    SITEMAP_SHARDS.map(
      (id) =>
        `  <sitemap>\n    <loc>${url}/sitemap/${id}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>`,
    ).join('\n') +
    `\n</sitemapindex>\n`;
  return new NextResponse(body, { headers: SITEMAP_CACHE_HEADERS });
}
