import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site-url';

// Robots directives. Search-result URLs are non-indexable (their pages
// emit `robots: noindex`); we still block /api/ and /dev/ at the
// robots layer for defence in depth.

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/card/'],
        disallow: [
          '/api/',
          '/dev/',
          '/search',
          // Slice C: personal / auth surfaces. All page-level metadata
          // is already noindex, follow — these belt-and-braces
          // disallow lines keep well-behaved crawlers out entirely.
          '/account',
          '/settings',
          '/collection',
          '/watchlist',
          '/decks',
          '/sign-in',
          '/sign-up',
          '/auth/',
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
