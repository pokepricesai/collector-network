// Card-URL sitemap sharding. Google's per-sitemap ceiling is 50K URLs,
// so we split the card catalogue across a small number of shard
// routes. The shard number is deliberately conservative — we can lift
// it once the ingest lands more cards than one shard can hold.

export const CARD_SITEMAP_SHARDS = 3 as const;

/** Deterministically bucket a URL string into a shard index in the
 *  range [1, CARD_SITEMAP_SHARDS]. */
export function shardForUrl(url: string): number {
  let h = 5381;
  for (let i = 0; i < url.length; i++) {
    h = ((h << 5) + h + url.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(h) % CARD_SITEMAP_SHARDS;
  return bucket + 1;
}
