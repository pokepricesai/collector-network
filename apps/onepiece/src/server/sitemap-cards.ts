import 'server-only';
import { NextResponse } from 'next/server';
import { SITE_ORIGIN } from '@/lib/seo';
import { CARD_SITEMAP_SHARDS, shardForUrl } from '@/lib/sitemap-shards';
import { getOnepieceClient, getOnepieceGameId } from './client';
import { slugifyCardName } from '@/lib/onepiece/slug';

// Shared implementation for the three sitemap-cards-N.xml shard
// routes. Each route file just calls buildShardResponse(N).
//
// Emits the logical /card/[slug] URL per unique card name — the
// treatment-grouped page is our canonical card surface.

const BUILD_ISO = new Date().toISOString();

interface CardRow {
  name: string;
  updated_at: string | null;
}

export async function buildShardResponse(shard: number): Promise<Response> {
  if (!Number.isFinite(shard) || shard < 1 || shard > CARD_SITEMAP_SHARDS) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);

  const seen = new Set<string>();
  const items: Array<{ url: string; lastmod: string }> = [];

  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('name,updated_at')
      .eq('game_id', gameId)
      .range(from, to);
    if (error) {
      return new NextResponse(`sitemap error: ${error.message}`, { status: 500 });
    }
    const rows = (data as CardRow[] | null) ?? [];
    for (const r of rows) {
      const slug = slugifyCardName(r.name);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const url = `${SITE_ORIGIN}/card/${encodeURIComponent(slug)}`;
      if (shardForUrl(url) !== shard) continue;
      items.push({ url, lastmod: safeIso(r.updated_at) });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  const urls = items
    .map(
      (p) =>
        '  <url>\n    <loc>' +
        p.url +
        '</loc>\n    <lastmod>' +
        p.lastmod +
        '</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>',
    )
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>';

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

function safeIso(input: string | null): string {
  if (!input) return BUILD_ISO;
  try {
    return new Date(input).toISOString();
  } catch {
    return BUILD_ISO;
  }
}
