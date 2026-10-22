import { buildShardResponse } from '@/server/sitemap-cards';

// Pure Supabase → XML (no cookies / auth / user state).
// `force-dynamic` was overriding `revalidate` and defeating ISR;
// every Googlebot hit re-ran the shard build. Removing it lets ISR
// cache the response for the 1h revalidate window. Pattern mirrors
// OPP commit 9b0a9ec.
export const revalidate = 3600;
export function GET() {
  return buildShardResponse(2);
}
