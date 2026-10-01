import 'server-only';
import { NextResponse } from 'next/server';
import { SITE_ORIGIN } from '@/lib/seo';
import { CARD_SITEMAP_SHARDS, shardForUrl } from '@/lib/sitemap-shards';
import { getLorcanaClient, getLorcanaGameId } from './client';
import { buildPrintingSlug, slugifyCardName } from '@/lib/lorcana/slug';

// Shared implementation for the three sitemap-cards-N.xml shard
// routes. Each route file just calls buildShardResponse(N).
//
// Emits TWO classes of URL per card row:
//   1. Logical card URL `/card/[slug]` — deduplicated per unique
//      base-name slug (one per logical card family).
//   2. Exact collectible URL `/set/[code]/card/[cn-slug]` — one per
//      tcg_cards row. Exact pages carry distinct canonical content
//      (specific rarity + collector number) and must not be collapsed
//      into the logical family.
//
// Both classes are hashed into the shard set via `shardForUrl`, so a
// URL always lands in a deterministic shard regardless of class.

const BUILD_ISO = new Date().toISOString();

interface CardRow {
  name: string;
  updated_at: string | null;
  collector_number: string | null;
  set_id: string;
}

interface SetMetaRow {
  id: string;
  code: string;
}

export async function buildShardResponse(shard: number): Promise<Response> {
  if (!Number.isFinite(shard) || shard < 1 || shard > CARD_SITEMAP_SHARDS) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = getLorcanaClient();
  const gameId = await getLorcanaGameId(supabase);

  // Set-id → set-code map, used to compose the exact-collectible URL
  // without issuing one join per row.
  const { data: setsData, error: setsErr } = await supabase
    .from('tcg_sets')
    .select('id, code')
    .eq('game_id', gameId);
  if (setsErr) {
    return new NextResponse(`sitemap error (sets): ${setsErr.message}`, { status: 500 });
  }
  const setCodeById = new Map<string, string>();
  for (const row of (setsData as SetMetaRow[] | null) ?? []) {
    setCodeById.set(row.id, row.code);
  }

  const seenLogical = new Set<string>();
  const items: Array<{ url: string; lastmod: string }> = [];

  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('name, updated_at, collector_number, set_id')
      .eq('game_id', gameId)
      .range(from, to);
    if (error) {
      return new NextResponse(`sitemap error: ${error.message}`, { status: 500 });
    }
    const rows = (data as CardRow[] | null) ?? [];
    for (const r of rows) {
      const slug = slugifyCardName(r.name);
      if (!slug) continue;

      // Logical card family URL — dedupe across all set rows.
      if (!seenLogical.has(slug)) {
        seenLogical.add(slug);
        const logicalUrl = `${SITE_ORIGIN}/card/${encodeURIComponent(slug)}`;
        if (shardForUrl(logicalUrl) === shard) {
          items.push({ url: logicalUrl, lastmod: safeIso(r.updated_at) });
        }
      }

      // Exact collectible URL — one per row, when we have both set
      // code + collector number. Skip rows that lack either; they
      // simply have no exact page.
      const setCode = setCodeById.get(r.set_id);
      if (!setCode || !r.collector_number) continue;
      const printingSlug = buildPrintingSlug(r.collector_number, r.name);
      const exactUrl =
        `${SITE_ORIGIN}/set/${encodeURIComponent(setCode.toLowerCase())}` +
        `/card/${encodeURIComponent(printingSlug)}`;
      if (shardForUrl(exactUrl) === shard) {
        items.push({ url: exactUrl, lastmod: safeIso(r.updated_at) });
      }
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
