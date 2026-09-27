import { buildShardResponse } from '@/server/sitemap-cards';

export const revalidate = 3600;
export const dynamic = 'force-dynamic';
export function GET() {
  return buildShardResponse(1);
}
