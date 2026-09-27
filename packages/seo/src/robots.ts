// packages/seo/src/robots.ts
// Robots.txt helper for Next.js metadata routes.
//
// Contract:
//   * Pre-launch (SITE_LAUNCHED != 'true'): allow crawl (so bots can
//     see the per-page noindex directive) but do NOT advertise the
//     sitemap. The site's `robots` metadata still emits noindex/nofollow.
//   * Launched: allow crawl and advertise the sitemap.
//
// Callers pass any private/auth paths to Disallow. /api and /auth are
// always disallowed as defence-in-depth.

import type { MetadataRoute } from 'next';

export interface RobotsInput {
  siteUrl: { launched: boolean; origin: string };
  /** Paths always to disallow on top of /api and /auth. */
  extraDisallow?: readonly string[];
  /** Paths to explicitly allow. Defaults to '/'. */
  allow?: readonly string[];
}

export function buildRobots(input: RobotsInput): MetadataRoute.Robots {
  const disallow = ['/api', '/auth', ...(input.extraDisallow ?? [])];
  const rules: MetadataRoute.Robots['rules'] = {
    userAgent: '*',
    allow: input.allow ? [...input.allow] : ['/'],
    disallow,
  };
  const out: MetadataRoute.Robots = { rules };
  if (input.siteUrl.launched) {
    out.sitemap = `${input.siteUrl.origin}/sitemap.xml`;
  }
  return out;
}
