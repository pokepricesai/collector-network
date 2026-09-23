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
import {
  RARITY_FAMILY_LABELS,
  type RarityFamily,
} from '../../../design/tokens';
import {
  SITEMAP_BYTE_CAP,
  SITEMAP_CACHE_HEADERS,
  SITEMAP_URL_CAP,
  printingShardForSlug,
  siteUrl,
  xmlEscape,
  type SitemapShard,
} from '../../../lib/sitemap-shared';

// Per-shard sitemap. Dynamic (server-rendered on first request) then
// cached for 24 hours. Slice 9 replaces this with an offline sitemap
// pipeline into blob storage.

export const dynamic = 'force-dynamic';
export const revalidate = 86_400;

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
    return [
      { loc: `${url}/`, lastmod: now, changefreq: 'daily', priority: 1.0 },
      { loc: `${url}/sets`, lastmod: now, changefreq: 'daily', priority: 0.9 },
      { loc: `${url}/rarities`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
      { loc: `${url}/archetypes`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
    ];
  }
  if (shard === 'cards') return buildCards(url);
  if (shard === 'sets') return buildSets(url);
  if (shard === 'rarities') return buildRarities(url);
  if (shard === 'archetypes') return buildArchetypes(url);
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

async function buildCards(url: string): Promise<Entry[]> {
  const seen = new Set<string>();
  const entries: Entry[] = [];
  let cursor: string | null = null;
  while (entries.length < SITEMAP_URL_CAP) {
    const { rows, nextCursor } = await listAllCardSlugs(undefined, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
      if (seen.has(r.slug)) continue;
      seen.add(r.slug);
      entries.push({
        loc: `${url}/card/${r.slug}`,
        lastmod: r.updatedAt,
        changefreq: 'weekly',
        priority: 0.7,
      });
      if (entries.length >= SITEMAP_URL_CAP) break;
    }
    if (!nextCursor) break;
    cursor = nextCursor;
  }
  return entries;
}

async function buildPrintings(url: string, shard: 0 | 1 | 2): Promise<Entry[]> {
  const entries: Entry[] = [];
  let cursor: string | null = null;
  while (entries.length < SITEMAP_URL_CAP) {
    const { rows, nextCursor } = await listAllPrintingRoutes(undefined, cursor);
    if (rows.length === 0) break;
    for (const r of rows) {
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
    if (!nextCursor) break;
    cursor = nextCursor;
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
