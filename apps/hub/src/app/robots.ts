import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/sites';

export default function robots(): MetadataRoute.Robots {
  const launched = process.env['VERCEL_ENV'] === 'production';
  const base: MetadataRoute.Robots = {
    rules: {
      userAgent: '*',
      allow: '/',
      // Admin is the private Collector Network OS. The real security
      // boundary is server-side authentication; this disallow saves
      // crawl budget and keeps the admin out of SERPs.
      disallow: ['/api/', '/admin/', '/admin'],
    },
  };
  if (launched) {
    base.sitemap = `${SITE_URL}/sitemap.xml`;
  }
  return base;
}
