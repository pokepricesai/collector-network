import type { MetadataRoute } from 'next';

// Robots directives. Search-result URLs are non-indexable (their pages
// emit `robots: noindex`); we still block /api/ and /dev/ at the
// robots layer for defence in depth.

export default function robots(): MetadataRoute.Robots {
  const siteUrl =
    process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://duelistprices.example';
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/card/'],
        disallow: ['/api/', '/dev/', '/search'],
      },
    ],
    sitemap: `${siteUrl}/sitemap-index.xml`,
  };
}
