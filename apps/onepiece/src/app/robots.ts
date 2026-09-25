import type { MetadataRoute } from 'next';
import { SITE_LAUNCHED, SITE_URL } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  // Pre-launch: keep the site crawlable so bots see the per-page
  // noindex directive, but don't advertise the sitemap.
  const rules: MetadataRoute.Robots['rules'] = {
    userAgent: '*',
    allow: '/',
    disallow: ['/api'],
  };
  const out: MetadataRoute.Robots = { rules };
  if (SITE_LAUNCHED) {
    out.sitemap = `${SITE_URL}/sitemap.xml`;
  }
  return out;
}
