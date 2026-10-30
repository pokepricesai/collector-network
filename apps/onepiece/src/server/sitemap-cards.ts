import 'server-only';
import { NextResponse } from 'next/server';
import { SITE_ORIGIN } from '@/lib/seo';
import { CARD_SITEMAP_SHARDS, shardForUrl } from '@/lib/sitemap-shards';
import { getOnepieceClient, getOnepieceGameId } from './client';
import {
  baseCollectorNumber,
  buildPrintingSlug,
  slugifyCardName,
} from '@/lib/onepiece/slug';

// Shared implementation for the three sitemap-cards-N.xml shard
// routes. Each route file calls buildShardResponse(N).
//
// Two URL kinds are emitted:
//
//   Level B (exact variant, `_p*` / `_r*` suffix preserved):
//     /set/{setCode}/card/{cn-with-suffix}-{nameSlug}
//     one URL per tcg_cards row (5,538 today) — this is where a
//     collector lands to see prices and is the canonical destination
//     of every Card Finder tile after Phase 8.
//
//   Level A (base card overview, no suffix):
//     /card/{baseCollector}-{nameSlug}
//     one URL per unique (base_collector, name_slug) — collects every
//     version of the same base card onto one page. NEVER the legacy
//     name-only slug (that mapped many game cards named "Roronoa
//     Zoro" onto one URL and Google would canonicalise them away).
//
// Sharding: consistent stringHash → shard N in [1, CARD_SITEMAP_SHARDS].

const BUILD_ISO = new Date().toISOString();

interface CardRow {
  collector_number: string | null;
  name: string;
  updated_at: string | null;
  tcg_sets: { code: string | null } | null;
}

export async function buildShardResponse(shard: number): Promise<Response> {
  if (!Number.isFinite(shard) || shard < 1 || shard > CARD_SITEMAP_SHARDS) {
    return new NextResponse('Not found', { status: 404 });
  }

  const supabase = getOnepieceClient();
  const gameId = await getOnepieceGameId(supabase);

  interface Item { url: string; lastmod: string; priority: string; changefreq: string }
  const items: Item[] = [];
  const variantSeen = new Set<string>();
  const overviewSeen = new Set<string>();

  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('tcg_cards')
      .select('collector_number,name,updated_at,tcg_sets!inner(code)')
      .eq('game_id', gameId)
      .range(from, to);
    if (error) {
      return new NextResponse(`sitemap error: ${error.message}`, { status: 500 });
    }
    const rows = (data as unknown as CardRow[] | null) ?? [];
    for (const r of rows) {
      const setCodeRaw = (r.tcg_sets?.code ?? '').trim();
      // Skip sets whose code contains whitespace — the /set/[slug] route
      // doesn't resolve percent-encoded whitespace (ST01 PRE, empty).
      if (!setCodeRaw || /\s/.test(setCodeRaw)) continue;
      const setCode = setCodeRaw.toLowerCase();
      if (!r.collector_number || !r.name) continue;
      const nameSlug = slugifyCardName(r.name);
      if (!nameSlug) continue;

      // Level B — exact variant page. Preserves _p1/_p2/_r1.
      const variantSlug = buildPrintingSlug(r.collector_number, r.name);
      const variantUrl = `${SITE_ORIGIN}/set/${encodeURIComponent(setCode)}/card/${encodeURIComponent(variantSlug)}`;
      if (!variantSeen.has(variantUrl)) {
        variantSeen.add(variantUrl);
        if (shardForUrl(variantUrl) === shard) {
          items.push({
            url: variantUrl,
            lastmod: safeIso(r.updated_at),
            changefreq: 'daily',
            priority: '0.8',
          });
        }
      }

      // Level A — base card overview. One URL per (base, name).
      const baseCollector = baseCollectorNumber(r.collector_number);
      if (baseCollector) {
        const overviewSlug = buildPrintingSlug(baseCollector, r.name);
        const overviewUrl = `${SITE_ORIGIN}/card/${encodeURIComponent(overviewSlug)}`;
        if (!overviewSeen.has(overviewUrl)) {
          overviewSeen.add(overviewUrl);
          if (shardForUrl(overviewUrl) === shard) {
            items.push({
              url: overviewUrl,
              lastmod: safeIso(r.updated_at),
              changefreq: 'weekly',
              priority: '0.6',
            });
          }
        }
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  // CN-05 Sprint 8 — defensive guard against caching an empty sitemap.
  //
  // Sprint 7 found shards 2 + 3 serving 110-byte empty <urlset>s on
  // production even though the generator was logically correct and a
  // cache-bust query (`?cb=…`) immediately returned the full 583KB /
  // 599KB / 594KB payloads. Root cause: a prior build-time prerender
  // ran with a stub Supabase client (SUPABASE_URL unavailable at
  // build time), produced 0 cards, and Vercel baked the empty XML
  // into the prerender cache for the no-query path. ISR did not
  // self-heal because repeat empty regenerations would simply
  // overwrite empty with empty.
  //
  // If the Supabase client returned 0 cards in total (variantSeen is
  // populated for every card across all shards, not just this one),
  // throw 500. Vercel never caches 5xx responses from an ISR route,
  // so the next request retries. In the happy path this guard is a
  // no-op.
  if (variantSeen.size === 0) {
    return new NextResponse(
      'sitemap error: zero cards returned from Supabase (stub client? missing env?)',
      { status: 500 },
    );
  }

  const urls = items
    .map(
      (p) =>
        '  <url>\n    <loc>' +
        p.url +
        '</loc>\n    <lastmod>' +
        p.lastmod +
        '</lastmod>\n    <changefreq>' +
        p.changefreq +
        '</changefreq>\n    <priority>' +
        p.priority +
        '</priority>\n  </url>',
    )
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls +
    '\n</urlset>';

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      // Route-level `revalidate = 3600` is ignored on raw NextResponse
      // bodies — Vercel's edge cache only honours it when the handler
      // returns via the metadata-route pathway. Setting s-maxage here
      // makes the shard genuinely cacheable; each warm hit saves a
      // paginated Supabase scan over ~thousands of card URLs.
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
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
