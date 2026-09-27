// Central indexability policy. One source of truth so the sitemap,
// per-route metadata and the SEO audit script agree on what should
// and should not be indexed.
//
// SITE_LAUNCHED gates the *global* index/follow default in layout.tsx.
// Private routes must remain noindex whether launched or not.

import { SITE_URL } from './site-url';

export type IndexPolicy = 'INDEX' | 'NOINDEX' | 'AUTH' | 'API' | 'PARAM_VARIANT';

export const ROUTE_POLICY: { pattern: RegExp; policy: IndexPolicy; note?: string }[] = [
  { pattern: /^\/$/,                                policy: 'INDEX', note: 'Homepage' },
  { pattern: /^\/browse$/,                          policy: 'INDEX', note: 'Sets directory' },
  { pattern: /^\/colours$/,                         policy: 'INDEX', note: 'Colours index' },
  { pattern: /^\/colours\/[a-z]+$/,                 policy: 'INDEX', note: 'Colour detail' },
  { pattern: /^\/leaders$/,                         policy: 'INDEX', note: 'Leaders index' },
  { pattern: /^\/market$/,                          policy: 'INDEX', note: 'Market movers hub' },
  { pattern: /^\/card-finder$/,                     policy: 'INDEX', note: 'Card finder tool' },
  { pattern: /^\/insights$/,                        policy: 'INDEX', note: 'Insights index' },
  { pattern: /^\/insights\/[a-z0-9-]+$/,            policy: 'INDEX', note: 'Insight article' },
  { pattern: /^\/set\/[a-z0-9-]+$/,                 policy: 'INDEX', note: 'Set detail' },
  { pattern: /^\/set\/[a-z0-9-]+\/card\/[^/]+$/,    policy: 'INDEX', note: 'Card printing detail' },
  { pattern: /^\/card\/[^/]+$/,                     policy: 'INDEX', note: 'Logical card page (treatments)' },
  { pattern: /^\/contact$/,                         policy: 'INDEX' },
  { pattern: /^\/privacy$/,                         policy: 'INDEX' },
  { pattern: /^\/terms$/,                           policy: 'INDEX' },

  // Search: renders on GET but must not be indexed (unbounded params).
  { pattern: /^\/cards\/search$/,                   policy: 'PARAM_VARIANT', note: 'Search results, canonical to self, noindex' },

  // Not present yet — reserved for future auth-gated surfaces once the
  // shared auth work lands.
  { pattern: /^\/login$/,                           policy: 'AUTH' },
  { pattern: /^\/account$/,                        policy: 'AUTH' },
  { pattern: /^\/settings$/,                       policy: 'AUTH' },
  { pattern: /^\/collection(\/.*)?$/,              policy: 'AUTH' },

  // Non-HTML.
  { pattern: /^\/api\//,                           policy: 'API' },
  { pattern: /^\/auth\//,                          policy: 'API' },
  { pattern: /^\/sitemap.*\.xml$/,                 policy: 'API' },
  { pattern: /^\/robots\.txt$/,                    policy: 'API' },
  { pattern: /^\/opengraph-image/,                 policy: 'API' },
  { pattern: /^\/icon\.png$/,                      policy: 'API' },
  { pattern: /^\/apple-icon\.png$/,                policy: 'API' },
  { pattern: /^\/favicon\.png$/,                   policy: 'API' },
];

export function policyForPath(path: string): IndexPolicy {
  for (const entry of ROUTE_POLICY) {
    if (entry.pattern.test(path)) return entry.policy;
  }
  return 'NOINDEX';
}

export const SITE_ORIGIN = SITE_URL;

export function canonicalFor(path: string, opts: { keepQuery?: boolean } = {}): string {
  const clean = opts.keepQuery ? path : (path.split('?')[0] ?? path);
  return `${SITE_ORIGIN}${clean}`;
}

export const TITLE_BRAND_SUFFIX = ' · OnePiecePrices';

export function isSitemapEligible(path: string): boolean {
  return policyForPath(path) === 'INDEX';
}
