import { NextResponse } from 'next/server';
import { SITE_ORIGIN } from '@/lib/seo';
import { listSetsWithCounts } from '@/server/browse';

// Set-URL sitemap. Pulls every set from the shared tcg_sets table
// scoped by One Piece. lastmod is the set's tcggraph updated_at when
// present, else the build ISO — matches the MTGPrices strategy.

const BUILD_ISO = new Date().toISOString();
export const revalidate = 3600;
// Needs live Supabase — never prerender at build time. ISR takes over
// at runtime via the revalidate window above.
export const dynamic = 'force-dynamic';

export async function GET() {
  const sets = await listSetsWithCounts();
  const items = sets.map((s) => {
    const lastmod = s.set.updated_at ?? s.set.released_at ?? BUILD_ISO;
    return {
      url: `${SITE_ORIGIN}/set/${encodeURIComponent(s.set.code.toLowerCase())}`,
      lastmod: safeIso(lastmod),
      priority: '0.75',
      changefreq: 'weekly',
    };
  });

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

function safeIso(input: string): string {
  try {
    return new Date(input).toISOString();
  } catch {
    return BUILD_ISO;
  }
}
