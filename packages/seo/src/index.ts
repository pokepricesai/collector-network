// @collector-network/seo — shared *technical* SEO helpers.
//
// Scope: canonical origin, SITE_LAUNCHED-aware robots emission,
// sitemap index/shard XML builders, JSON-LD structured-data builders,
// fail-safe IndexNow submission, production-domain validation.
//
// Explicitly out of scope: page copy, headings, IA, editorial voice,
// game-specific metadata — those stay per-site.

export { createSiteUrl } from './site-url';
export type { SiteUrl, SiteUrlOptions } from './site-url';

export { buildRobots } from './robots';
export type { RobotsInput } from './robots';

export {
  SITEMAP_URL_CAP, SITEMAP_BYTE_CAP, SITEMAP_CACHE_HEADERS,
  xmlEscape, buildSitemapIndex, buildUrlset, shardForSlug,
} from './sitemap';
export type { SitemapIndexEntry, SitemapUrlEntry } from './sitemap';

export {
  readIndexNowConfig, canonicaliseUrls, submitIndexNow,
} from './indexnow';
export type {
  IndexNowConfig, IndexNowBatchResult, IndexNowResult,
} from './indexnow';

export {
  buildOrganization, buildWebSite, buildBreadcrumbs,
  buildProduct, buildCollectionPage, jsonLd,
} from './structured-data';
export type {
  OrganizationSchema, WebSiteSchema, BreadcrumbListSchema,
  BreadcrumbItem, ProductSchema, CollectionPageSchema, ProductOfferInput,
} from './structured-data';

export { assertProductionUrl, assertExactProductionHost } from './domain';
export type { DomainCheck } from './domain';
