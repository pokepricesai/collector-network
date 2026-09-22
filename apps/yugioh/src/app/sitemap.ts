import type { MetadataRoute } from 'next';

// Slice 5 sitemap: homepage only. Card / printing sitemaps land with
// Slice 6, sets with Slice 7 or when set pages exist. We deliberately
// do NOT list /search here — search-result URLs are noindex + user-
// specific query strings.

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl =
    process.env['NEXT_PUBLIC_SITE_URL'] ?? 'https://duelistprices.example';
  return [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];
}
