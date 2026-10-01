import type { MetadataRoute } from 'next';
import { SITE_LAUNCHED, SITE_URL } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  // Pre-launch: keep the site crawlable so bots see the per-page
  // noindex directive, but don't advertise the sitemap.
  //
  // Disallows cover routes that are either private (owner-only) or
  // ambiguous for crawlers (search param space, auth entry points).
  // The per-page `robots: { index: false }` already shields these
  // from indexing; the robots.txt disallow saves crawl budget.
  const rules: MetadataRoute.Robots['rules'] = {
    userAgent: '*',
    allow: '/',
    disallow: [
      '/api/',
      '/auth/',
      '/account',
      '/dashboard',
      '/collection',
      '/watchlist',
      '/settings',
      '/sign-in',
      '/sign-up',
      '/cards/search',
    ],
  };
  const out: MetadataRoute.Robots = { rules };
  if (SITE_LAUNCHED) {
    out.sitemap = `${SITE_URL}/sitemap.xml`;
  }
  return out;
}
