import { buildShardResponse } from '@/server/sitemap-cards';

// Pure Supabase → XML (no cookies / auth / user state). `force-dynamic`
// was overriding `revalidate` and defeating ISR, so every bot crawl
// re-ran the shard build. Removing it lets ISR cache the response
// for the 1h revalidate window.
export const revalidate = 3600;
export function GET() {
  return buildShardResponse(1);
}
