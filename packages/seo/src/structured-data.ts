// packages/seo/src/structured-data.ts
// JSON-LD structured-data builders. Emit plain objects; callers wrap in
// <script type="application/ld+json">.
//
// Types intentionally minimal — the schema.org vocab is huge and each
// game surface only needs a small subset for launch (Product, Card,
// BreadcrumbList, CollectionPage, Organization, WebSite).

export interface OrganizationSchema {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  name: string;
  url: string;
  logo?: string;
  sameAs?: string[];
}

export function buildOrganization(opts: {
  name: string; url: string; logo?: string; sameAs?: string[];
}): OrganizationSchema {
  const s: OrganizationSchema = { '@context': 'https://schema.org', '@type': 'Organization', name: opts.name, url: opts.url };
  if (opts.logo) s.logo = opts.logo;
  if (opts.sameAs?.length) s.sameAs = [...opts.sameAs];
  return s;
}

export interface WebSiteSchema {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  name: string;
  url: string;
  potentialAction?: {
    '@type': 'SearchAction';
    target: { '@type': 'EntryPoint'; urlTemplate: string };
    'query-input': string;
  };
}

export function buildWebSite(opts: {
  name: string; url: string; searchUrlTemplate?: string;
}): WebSiteSchema {
  const s: WebSiteSchema = { '@context': 'https://schema.org', '@type': 'WebSite', name: opts.name, url: opts.url };
  if (opts.searchUrlTemplate) {
    s.potentialAction = {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: opts.searchUrlTemplate },
      'query-input': 'required name=search_term_string',
    };
  }
  return s;
}

export interface BreadcrumbItem { name: string; url: string }

export interface BreadcrumbListSchema {
  '@context': 'https://schema.org';
  '@type': 'BreadcrumbList';
  itemListElement: {
    '@type': 'ListItem';
    position: number;
    name: string;
    item: string;
  }[];
}

export function buildBreadcrumbs(items: readonly BreadcrumbItem[]): BreadcrumbListSchema {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem', position: i + 1, name: it.name, item: it.url,
    })),
  };
}

export interface ProductOfferInput {
  price: number;
  currency: string;
  url: string;
  availability?: 'InStock' | 'OutOfStock' | 'PreOrder' | 'LimitedAvailability';
  seller?: string;
}

export interface ProductSchema {
  '@context': 'https://schema.org';
  '@type': 'Product';
  name: string;
  description?: string;
  image?: string;
  sku?: string;
  brand?: { '@type': 'Brand'; name: string };
  offers?: {
    '@type': 'AggregateOffer' | 'Offer';
    priceCurrency: string;
    lowPrice?: number;
    highPrice?: number;
    price?: number;
    offerCount?: number;
    availability?: string;
    url?: string;
  };
}

export function buildProduct(opts: {
  name: string;
  description?: string;
  image?: string;
  sku?: string;
  brand?: string;
  offers?: {
    currency: string;
    lowPrice?: number;
    highPrice?: number;
    price?: number;
    offerCount?: number;
    availability?: string;
    url?: string;
  };
}): ProductSchema {
  const p: ProductSchema = { '@context': 'https://schema.org', '@type': 'Product', name: opts.name };
  if (opts.description) p.description = opts.description;
  if (opts.image) p.image = opts.image;
  if (opts.sku) p.sku = opts.sku;
  if (opts.brand) p.brand = { '@type': 'Brand', name: opts.brand };
  if (opts.offers) {
    const isAggregate = opts.offers.lowPrice != null || opts.offers.highPrice != null || opts.offers.offerCount != null;
    p.offers = {
      '@type': isAggregate ? 'AggregateOffer' : 'Offer',
      priceCurrency: opts.offers.currency,
    };
    if (opts.offers.lowPrice != null) p.offers.lowPrice = opts.offers.lowPrice;
    if (opts.offers.highPrice != null) p.offers.highPrice = opts.offers.highPrice;
    if (opts.offers.price != null) p.offers.price = opts.offers.price;
    if (opts.offers.offerCount != null) p.offers.offerCount = opts.offers.offerCount;
    if (opts.offers.availability) p.offers.availability = `https://schema.org/${opts.offers.availability}`;
    if (opts.offers.url) p.offers.url = opts.offers.url;
  }
  return p;
}

export interface CollectionPageSchema {
  '@context': 'https://schema.org';
  '@type': 'CollectionPage';
  name: string;
  url: string;
  description?: string;
  mainEntity?: unknown;
}

export function buildCollectionPage(opts: {
  name: string; url: string; description?: string; mainEntity?: unknown;
}): CollectionPageSchema {
  const s: CollectionPageSchema = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: opts.name, url: opts.url };
  if (opts.description) s.description = opts.description;
  if (opts.mainEntity) s.mainEntity = opts.mainEntity;
  return s;
}

/** Convenience: JSON.stringify with tag-safe escaping so the output
 *  is safe to embed in <script type="application/ld+json">. */
export function jsonLd(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
