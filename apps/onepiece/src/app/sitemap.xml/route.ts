import { NextResponse } from 'next/server';
import { CARD_SITEMAP_SHARDS } from '@/lib/sitemap-shards';
import { SITE_URL } from '@/lib/site-url';

// Sitemap index. Sub-sitemaps for pages, sets and card shards.
// Uses <sitemapindex> per the sitemaps.org spec. lastmod is a
// build-scoped ISO timestamp so crawlers see a meaningful change
// signal once per deploy rather than once per hour.

const BUILD_ISO = new Date().toISOString();
export const revalidate = 3600;

export async function GET() {
  const sub: string[] = ['sitemap-pages.xml', 'sitemap-sets.xml'];
  for (let i = 1; i <= CARD_SITEMAP_SHARDS; i++) {
    sub.push(`sitemap-cards-${i}.xml`);
  }

  const entries = sub
    .map(
      (name) =>
        `  <sitemap>\n    <loc>${SITE_URL}/${name}</loc>\n    <lastmod>${BUILD_ISO}</lastmod>\n  </sitemap>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
