import { NextResponse } from 'next/server';
import { SITE_ORIGIN } from '@/lib/seo';
import { listCharacters } from '@/server/characters';

// Character-page sitemap. One URL per base-name character slug — the
// same universe the /characters directory lists. Pulled from the
// shared `listCharacters` taxonomy cache so new characters flow in on
// the next revalidate.

const BUILD_ISO = new Date().toISOString();
export const revalidate = 3600;
export const dynamic = 'force-dynamic';

export async function GET() {
  const characters = await listCharacters();
  const items = characters.map((c) => ({
    url: `${SITE_ORIGIN}/character/${encodeURIComponent(c.slug)}`,
    lastmod: BUILD_ISO,
    priority: '0.7',
    changefreq: 'weekly',
  }));

  const urls = items
    .map(
      (p) =>
        '  <url>\n    <loc>' +
        p.url +
        '</loc>\n    <lastmod>' +
        p.lastmod +
        '</lastmod>\n    <changefreq>' +
        p.changefreq +
        '</changefreq>\n    <priority>' +
        p.priority +
        '</priority>\n  </url>',
    )
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>';

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
