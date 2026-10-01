import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/sites';

export default function robots(): MetadataRoute.Robots {
  const launched = process.env['VERCEL_ENV'] === 'production';
  const base: MetadataRoute.Robots = {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/'],
    },
  };
  if (launched) {
    base.sitemap = `${SITE_URL}/sitemap.xml`;
  }
  return base;
}
