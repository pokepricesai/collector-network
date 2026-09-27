// packages/seo/src/sitemap.ts
// Shared sitemap-index + shard XML builders.
//
// Design:
//   * Google's spec: 50,000 URLs / 50 MB uncompressed per sitemap file.
//     Callers get SITEMAP_URL_CAP and SITEMAP_BYTE_CAP as safe defaults.
//   * `xmlEscape` covers &, <, >, ", ' — safe for every <loc> and
//     <lastmod>.
//   * `SITEMAP_CACHE_HEADERS` is the same headers pattern OP+Lorcana
//     use in production: 1h edge, 24h shared, XML content-type.
//   * `buildSitemapIndex` and `buildUrlset` emit strings, not Response
//     objects, so callers can wrap them in whichever framework's
//     Response.

export const SITEMAP_URL_CAP = 45_000;
export const SITEMAP_BYTE_CAP = 50 * 1024 * 1024;

export const SITEMAP_CACHE_HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, s-maxage=86400',
} as const;

export function xmlEscape(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface SitemapIndexEntry {
  loc: string;
  lastmod?: string;
}

export function buildSitemapIndex(entries: readonly SitemapIndexEntry[]): string {
  const now = new Date().toISOString();
  const items = entries
    .map((e) => {
      const lm = e.lastmod ?? now;
      return `  <sitemap>\n    <loc>${xmlEscape(e.loc)}</loc>\n    <lastmod>${xmlEscape(lm)}</lastmod>\n  </sitemap>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${items}\n` +
    `</sitemapindex>\n`
  );
}

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export function buildUrlset(entries: readonly SitemapUrlEntry[]): string {
  const items = entries
    .map((e) => {
      const parts: string[] = [`    <loc>${xmlEscape(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`    <lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
      if (e.changefreq) parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
      if (e.priority != null) parts.push(`    <priority>${e.priority.toFixed(2)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${items}\n` +
    `</urlset>\n`
  );
}

/** Deterministic bucket for a card slug into shards [1..N]. Uses a
 *  small djb2 hash so distribution is stable across builds. */
export function shardForSlug(slug: string, shards: number): number {
  let h = 5381;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) + h + slug.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % shards) + 1;
}
