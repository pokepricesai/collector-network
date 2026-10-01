import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/sites';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`,         lastModified: now, changeFrequency: 'monthly', priority: 1.0 },
    { url: `${SITE_URL}/about`,    lastModified: now, changeFrequency: 'yearly',  priority: 0.7 },
    { url: `${SITE_URL}/partner`,  lastModified: now, changeFrequency: 'yearly',  priority: 0.9 },
    { url: `${SITE_URL}/contact`,  lastModified: now, changeFrequency: 'yearly',  priority: 0.6 },
  ];
}
