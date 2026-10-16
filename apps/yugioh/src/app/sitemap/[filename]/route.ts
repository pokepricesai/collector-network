import { NextResponse } from 'next/server';
import {
  listAllCardSlugs,
  listAllPrintingRoutes,
} from '../../../server/card';
import {
  listYugiohArchetypesForDirectory,
  listYugiohRaritiesForDirectory,
  listYugiohSetsForDirectory,
} from '../../../server/browse';
import { listPublicDecksForSitemap } from '../../../server/deck-publishing';
import { listNetworkArticles } from '../../../server/network-articles';
import { CACHE_TTL } from '../../../server/cache';
import { getYugiohClient } from '../../../server/read';
import { normalisePrintingKey, toCardSlug } from '../../../lib/slug';
import {
  RARITY_FAMILY_LABELS,
  type RarityFamily,
} from '../../../design/tokens';
import {
  SITEMAP_BYTE_CAP,
  SITEMAP_CACHE_HEADERS,
  SITEMAP_SHARDS,
  SITEMAP_URL_CAP,
  printingShardForSlug,
  siteUrl,
  xmlEscape,
  type SitemapShard,
} from '../../../lib/sitemap-shared';

// Per-shard sitemap. CN-SEO-FINAL-01 (2026-10-17):
//
// The previous version carried `export const dynamic = 'force-dynamic'`
// which disabled Next's Full Route Cache; combined with ~172 sequential
// Supabase round-trips in the printings scan this gave 30-120s cold-
// origin times. Replaced with the on-demand ISR pattern used by other
// dynamic YGO routes (/set/[slug]), so first-hit-per-region per 24h
// pays the scan cost once and every subsequent request serves the
// pre-rendered XML from the edge.
//
// The in-process memoisation (memoiseInstance) also still applies
// across shards within one warm Lambda, so the three printings shards
// share the inventory build within a region.
export const revalidate = 86_400;
export const dynamicParams = true;
export const maxDuration = 60;

// Register the 9 shard filenames so Next's router caches each variant
// after first render. Returning [] is also legal but surfacing the
// known filenames gives the build-time analyser a crisp picture.
export function generateStaticParams(): { filename: string }[] {
  return SITEMAP_SHARDS.map((shard) => ({ filename: `${shard}.xml` }));
}

interface Entry {
  loc: string;
  lastmod?: string | null;
  changefreq: 'daily' | 'weekly';
  priority: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  // Match /sitemap/<shard>.xml — Next's app router matches [filename]
  // literally; the `.xml` suffix arrives inside the param, so we strip
  // it here.
  if (!filename.endsWith('.xml')) {
    return new NextResponse('sitemap URLs must end with .xml', { status: 404 });
  }
  const shard = filename.slice(0, -4);
  const validShards: SitemapShard[] = [
    'base',
    'cards',
    'printings-0',
    'printings-1',
    'printings-2',
    'sets',
    'rarities',
    'archetypes',
    'public-decks',
  ];
  if (!validShards.includes(shard as SitemapShard)) {
    return new NextResponse(`unknown sitemap shard: ${shard}`, { status: 404 });
  }
  const entries = await buildShard(shard as SitemapShard);
  return new NextResponse(renderUrlset(entries), { headers: SITEMAP_CACHE_HEADERS });
}

async function buildShard(shard: SitemapShard): Promise<Entry[]> {
  const url = siteUrl();
  if (shard === 'base') {
    const now = new Date().toISOString();
    const base: Entry[] = [
      { loc: `${url}/`, lastmod: now, changefreq: 'daily', priority: 1.0 },
      { loc: `${url}/market`, lastmod: now, changefreq: 'daily', priority: 0.9 },
      { loc: `${url}/market/most-valuable`, lastmod: now, changefreq: 'daily', priority: 0.8 },
      { loc: `${url}/market/graded`, lastmod: now, changefreq: 'daily', priority: 0.8 },
      { loc: `${url}/market/vintage`, lastmod: now, changefreq: 'daily', priority: 0.8 },
      { loc: `${url}/forbidden-limited`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
      { loc: `${url}/sets`, lastmod: now, changefreq: 'daily', priority: 0.9 },
      { loc: `${url}/rarities`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
      { loc: `${url}/archetypes`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
      { loc: `${url}/insights`, lastmod: now, changefreq: 'weekly', priority: 0.75 },
      { loc: `${url}/insights/most-valuable-yugioh-cards`, lastmod: '2026-09-28', changefreq: 'weekly', priority: 0.7 },
      { loc: `${url}/insights/yugioh-rarities-explained`, lastmod: '2026-09-28', changefreq: 'weekly', priority: 0.7 },
      { loc: `${url}/insights/yugioh-collecting-guide-sets-editions-rarities-prices`, lastmod: '2026-09-28', changefreq: 'weekly', priority: 0.7 },
    ];
    // CN-04A: include Collector Network OS published articles so
    // Content-Engine-authored pieces (publication_target='ygo_db',
    // status='published') are indexable alongside the hardcoded
    // launch registry above.
    const hardcoded = new Set([
      '/insights/most-valuable-yugioh-cards',
      '/insights/yugioh-rarities-explained',
      '/insights/yugioh-collecting-guide-sets-editions-rarities-prices',
    ]);
    const netArticles = await listNetworkArticles();
    for (const article of netArticles) {
      const path = `/insights/${article.slug}`;
      if (hardcoded.has(path)) continue;
      base.push({
        loc: `${url}${path}`,
        lastmod: article.updatedAt ?? null,
        changefreq: 'weekly',
        priority: 0.7,
      });
    }
    return base;
  }
  if (shard === 'cards') return buildCards(url);
  if (shard === 'sets') return buildSets(url);
  if (shard === 'rarities') return buildRarities(url);
  if (shard === 'archetypes') return buildArchetypes(url);
  if (shard === 'public-decks') return buildPublicDecks(url);
  const printingShard: 0 | 1 | 2 =
    shard === 'printings-0' ? 0 : shard === 'printings-1' ? 1 : 2;
  return buildPrintings(url, printingShard);
}

async function buildSets(url: string): Promise<Entry[]> {
  const entries = await listYugiohSetsForDirectory();
  return entries.slice(0, SITEMAP_URL_CAP).map((entry) => ({
    loc: `${url}/set/${encodeURIComponent(entry.set.code.toLowerCase())}`,
    lastmod: entry.set.updated_at ?? entry.set.released_at ?? null,
    changefreq: 'weekly',
    priority: 0.8,
  }));
}

async function buildRarities(url: string): Promise<Entry[]> {
  const entries = await listYugiohRaritiesForDirectory();
  return entries
    .filter((e) => e.totalCards > 0)
    .slice(0, SITEMAP_URL_CAP)
    .map((entry) => ({
      loc: `${url}/rarity/${entry.family as RarityFamily}`,
      lastmod: null,
      changefreq: 'weekly',
      priority: 0.7,
      // RARITY_FAMILY_LABELS reference kept so a type change to the
      // enum breaks this shard at compile time.
      _label: RARITY_FAMILY_LABELS[entry.family as RarityFamily],
    })) as Entry[];
}

async function buildArchetypes(url: string): Promise<Entry[]> {
  const entries = await listYugiohArchetypesForDirectory();
  return entries.slice(0, SITEMAP_URL_CAP).map((entry) => ({
    loc: `${url}/archetype/${entry.slug}`,
    lastmod: null,
    changefreq: 'weekly',
    priority: 0.6,
  }));
}

// Only public decks. Unlisted decks are never enumerable — the
// underlying RLS/RPC layer would refuse them anyway, but we don't
// even ask the DB for them.
async function buildPublicDecks(url: string): Promise<Entry[]> {
  const decks = await listPublicDecksForSitemap(SITEMAP_URL_CAP);
  return decks.map((d) => ({
    loc: `${url}/deck/${encodeURIComponent(d.slug)}`,
    lastmod: d.updatedAt ?? d.publishedAt,
    changefreq: 'weekly',
    priority: 0.5,
  }));
}

// Cached full-inventory helpers. These do the DB-heavy work — a
// production scan of all card names or all printing routes. Wrapped in
// unstable_cache so subsequent shards (and subsequent regions/instances
// via Vercel Data Cache) reuse the result for 24 hours.
interface CardInventoryRow {
  slug: string;
  updatedAt: string | null;
}

async function _cardInventoryRaw(): Promise<CardInventoryRow[]> {
  const seen = new Set<string>();
  const out: CardInventoryRow[] = [];
  let cursor: string | null = null;
  while (out.length < SITEMAP_URL_CAP) {
    const { rows, nextCursor } = await listAllCardSlugs(undefined, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      out.push({ slug: r.slug, updatedAt: r.updatedAt });
      if (out.length >= SITEMAP_URL_CAP) break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return out;
}

// The card inventory (~40k rows deduped) and printing inventory
// (~86k rows) are both larger than Next.js Data Cache's 2MB entry
// limit, so unstable_cache silently drops them. Per-instance
// memoisation gives us cross-shard sharing within a warm Lambda:
// the first sitemap shard to render pays the scan cost; the other
// two shards on the same instance return instantly.
const cachedFullCardInventory = memoiseInstance(
  _cardInventoryRaw,
  CACHE_TTL.SITEMAP_DAILY,
);

interface PrintingInventoryRow {
  cardSlug: string;
  collectorNumber: string;
  printingKey: string;
  updatedAt: string | null;
}

async function _printingInventoryRaw(): Promise<PrintingInventoryRow[]> {
  // CN-SEO-FINAL-01: the old implementation looped listAllPrintingRoutes
  // serially (1000-row page) and did a second query per page to
  // resolve card names, giving ~172 round-trips across the 86k
  // printing catalogue. Rewritten in two passes with the card-name
  // lookup done ONCE and the printings fetched in concurrent waves.
  const sb = getYugiohClient();

  // Pass 1 — load the full tcg_cards name map in one scan (~14k
  // rows). Single pass, ~2 round-trips at 10k per page.
  const nameByCardId = new Map<string, string>();
  {
    const CARD_PAGE = 10_000;
    for (let from = 0; from < 100_000; from += CARD_PAGE) {
      const { data, error } = await sb
        .from('tcg_cards')
        .select('id,name')
        .eq('game_id', 'ygo')
        .range(from, from + CARD_PAGE - 1);
      if (error) throw new Error(`[sitemap/printings] cards scan: ${error.message}`);
      const rows = (data as Array<{ id: string; name: string }> | null) ?? [];
      for (const r of rows) nameByCardId.set(r.id, r.name);
      if (rows.length < CARD_PAGE) break;
    }
  }

  // Pass 2 — printings. Concurrent waves of range queries so the
  // 86k scan runs in parallel-equivalent time rather than serially.
  interface PRow {
    tcg_card_id: string;
    collector_number: string | null;
    tcggraph_printing_key: string | null;
    updated_at: string | null;
  }
  const PRINT_PAGE = 2000;
  const CONCURRENCY = 10;
  const SAFETY_CAP = 500_000;
  const out: PrintingInventoryRow[] = [];
  let waveStart = 0;
  while (waveStart < SAFETY_CAP) {
    const waves = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const from = waveStart + i * PRINT_PAGE;
        return sb
          .from('tcg_printings')
          .select('tcg_card_id,collector_number,tcggraph_printing_key,updated_at')
          .eq('game_id', 'ygo')
          .range(from, from + PRINT_PAGE - 1);
      }),
    );
    let anyRows = false;
    let shortRead = false;
    for (const { data, error } of waves) {
      if (error) throw new Error(`[sitemap/printings] printings scan: ${error.message}`);
      const rows = (data as PRow[] | null) ?? [];
      if (rows.length > 0) anyRows = true;
      if (rows.length < PRINT_PAGE) shortRead = true;
      for (const r of rows) {
        const name = nameByCardId.get(r.tcg_card_id);
        if (!name || !r.collector_number) continue;
        const slug = toCardSlug(name);
        if (!slug) continue;
        out.push({
          cardSlug: slug,
          collectorNumber: r.collector_number,
          printingKey: normalisePrintingKey(r.tcggraph_printing_key),
          updatedAt: r.updated_at,
        });
      }
    }
    if (!anyRows) break;
    waveStart += CONCURRENCY * PRINT_PAGE;
    // If any wave was short, the next wave will contain nothing.
    // Stop one iteration early to avoid a redundant round-trip.
    if (shortRead && waves[waves.length - 1]!.data?.length === 0) break;
  }
  return out;
}

// listAllPrintingRoutes is kept exported from card.ts for API stability
// but is no longer called by the sitemap. Reference it so lint stays
// quiet and so a future caller can find it.
void listAllPrintingRoutes;

const cachedFullPrintingInventory = memoiseInstance(
  _printingInventoryRaw,
  CACHE_TTL.SITEMAP_DAILY,
);

// Per-instance TTL memoisation for payloads that exceed the Data
// Cache's 2MB entry limit. Serialises concurrent misses (single
// in-flight promise) so a burst of shard requests within one Lambda
// instance runs the scan exactly once. TTL is in seconds.
function memoiseInstance<T>(
  fn: () => Promise<T>,
  ttlSeconds: number,
): () => Promise<T> {
  let cache: { value: T; expiresAt: number } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (cache && Date.now() < cache.expiresAt) return cache.value;
    if (inflight) return inflight;
    inflight = fn()
      .then((value) => {
        cache = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
        return value;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

async function buildCards(url: string): Promise<Entry[]> {
  const inventory = await cachedFullCardInventory();
  return inventory.slice(0, SITEMAP_URL_CAP).map((r) => ({
    loc: `${url}/card/${r.slug}`,
    lastmod: r.updatedAt,
    changefreq: 'weekly',
    priority: 0.7,
  }));
}

async function buildPrintings(url: string, shard: 0 | 1 | 2): Promise<Entry[]> {
  const inventory = await cachedFullPrintingInventory();
  const entries: Entry[] = [];
  for (const r of inventory) {
    if (printingShardForSlug(r.cardSlug) !== shard) continue;
    entries.push({
      loc: `${url}/card/${r.cardSlug}/printing/${encodeURIComponent(
        r.collectorNumber,
      )}/${encodeURIComponent(r.printingKey)}`,
      lastmod: r.updatedAt,
      changefreq: 'weekly',
      priority: 0.5,
    });
    if (entries.length >= SITEMAP_URL_CAP) break;
  }
  return entries;
}

function renderUrlset(entries: Entry[]): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const e of entries) {
    parts.push(`  <url>`);
    parts.push(`    <loc>${xmlEscape(e.loc)}</loc>`);
    if (e.lastmod) {
      // lastmod may already be an ISO string; keep as-is for consistency
      parts.push(`    <lastmod>${xmlEscape(e.lastmod)}</lastmod>`);
    }
    parts.push(`    <changefreq>${e.changefreq}</changefreq>`);
    parts.push(`    <priority>${e.priority.toFixed(1)}</priority>`);
    parts.push(`  </url>`);
  }
  parts.push(`</urlset>`);
  const body = parts.join('\n') + '\n';
  // Google's 50 MB spec limit. If the shard grows past it we split
  // further and update sitemap-shared.ts. Log-only for now — the URL
  // cap normally kicks in first.
  const size = Buffer.byteLength(body, 'utf-8');
  if (size > SITEMAP_BYTE_CAP) {
    console.warn(
      `[sitemap] shard exceeded ${SITEMAP_BYTE_CAP} bytes (actual: ${size})`,
    );
  }
  return body;
}
