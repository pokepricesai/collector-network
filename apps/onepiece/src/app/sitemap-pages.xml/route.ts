import { NextResponse } from 'next/server';
import { SITE_ORIGIN, isSitemapEligible } from '@/lib/seo';
import { OP_COLOURS } from '@/lib/onepiece/colour';

// Hub / static pages sitemap. Colour landing pages and the top-level
// hubs live here; card and set URLs are in their own shards.

const BUILD_ISO = new Date().toISOString();

const STATIC: Array<{ path: string; priority: string; changefreq: string }> = [
  { path: '/',            priority: '1.0',  changefreq: 'daily'   },
  { path: '/browse',      priority: '0.9',  changefreq: 'daily'   },
  { path: '/market',      priority: '0.85', changefreq: 'daily'   },
  { path: '/card-finder', priority: '0.85', changefreq: 'weekly'  },
  { path: '/leaders',     priority: '0.8',  changefreq: 'weekly'  },
  { path: '/colours',     priority: '0.8',  changefreq: 'weekly'  },
  { path: '/insights',    priority: '0.75', changefreq: 'weekly'  },
  { path: '/contact',     priority: '0.3',  changefreq: 'monthly' },
  { path: '/privacy',     priority: '0.3',  changefreq: 'yearly'  },
  { path: '/terms',       priority: '0.3',  changefreq: 'yearly'  },
];

export async function GET() {
  type Item = { url: string; lastmod: string; changefreq: string; priority: string };
  const items: Item[] = [];

  for (const p of STATIC) {
    if (!isSitemapEligible(p.path)) continue;
    items.push({
      url: `${SITE_ORIGIN}${p.path}`,
      lastmod: BUILD_ISO,
      changefreq: p.changefreq,
      priority: p.priority,
    });
  }

  for (const colour of OP_COLOURS) {
    const path = `/colours/${colour}`;
    if (!isSitemapEligible(path)) continue;
    items.push({
      url: `${SITE_ORIGIN}${path}`,
      lastmod: BUILD_ISO,
      changefreq: 'weekly',
      priority: '0.7',
    });
  }

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
