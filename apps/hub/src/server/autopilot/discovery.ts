import 'server-only';

// Cheap deterministic discovery pass.
//
// For each enabled registered source, fetch its RSS/Atom feed (polite
// rate limit, bounded response size), parse the top N items with a
// minimal regex parser, and persist each unique signal to
// network_autopilot_discovered_signals.
//
// This module intentionally does NOT:
//   * run an LLM
//   * fetch an item's full page body
//   * download images
//
// A later checkpoint will add a per-URL "external fetcher" that pulls
// Open Graph meta + a short excerpt for each candidate the scorer
// picks. For now the discovery pass is title + link + published_at
// + optional feed summary — enough to drive the newsworthiness score.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscoveredSignal } from './types';
import type { AutopilotSiteSlug } from './config';
import { listEnabledSources, markSourceDiscovered, markSourceError, type SourceRow } from './sources';

const MAX_RESPONSE_BYTES = 2_000_000;        // 2 MB per feed
const MAX_ITEMS_PER_SOURCE = 20;
const FETCH_TIMEOUT_MS = 12_000;
const POLITE_DELAY_MS = 1_200;               // between sources
const UA = 'Collector-Network-Autopilot/1.0 (+contact: luke@collector-network)';

export interface DiscoveryRunResult {
  sources_scanned: number;
  signals_found: number;
  signals_inserted: number;
  signals_skipped_duplicate: number;
  errors: Array<{ source_id: string; source_name: string; message: string }>;
  cached: boolean;
  cache_age_minutes: number | null;
}

// Reads the latest cached signals from the DB; triggers a fresh
// discovery pass only when the newest signal is older than
// `maxAgeMinutes` or `force=true`.
export async function runDiscovery(
  sb: SupabaseClient,
  siteSlug: AutopilotSiteSlug,
  options: { force?: boolean; maxAgeMinutes?: number } = {},
): Promise<DiscoveryRunResult> {
  const maxAge = options.maxAgeMinutes ?? 60;

  if (!options.force) {
    const { data: newest } = await sb
      .from('network_autopilot_discovered_signals')
      .select('retrieved_at')
      .eq('site_slug', siteSlug)
      .order('retrieved_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const t = (newest as { retrieved_at: string } | null)?.retrieved_at;
    if (t) {
      const ageMin = Math.round((Date.now() - new Date(t).getTime()) / 60_000);
      if (ageMin < maxAge) {
        return {
          sources_scanned: 0,
          signals_found: 0,
          signals_inserted: 0,
          signals_skipped_duplicate: 0,
          errors: [],
          cached: true,
          cache_age_minutes: ageMin,
        };
      }
    }
  }

  const sources = await listEnabledSources(sb, siteSlug);
  const result: DiscoveryRunResult = {
    sources_scanned: 0,
    signals_found: 0,
    signals_inserted: 0,
    signals_skipped_duplicate: 0,
    errors: [],
    cached: false,
    cache_age_minutes: null,
  };

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    try {
      const { items, raw_count } = await fetchSourceSignals(source);
      result.sources_scanned += 1;
      result.signals_found += items.length;
      let inserted = 0;
      let dup = 0;
      for (const sig of items) {
        const ok = await persistSignal(sb, source, sig);
        if (ok === 'inserted') inserted += 1;
        else if (ok === 'duplicate') dup += 1;
      }
      result.signals_inserted += inserted;
      result.signals_skipped_duplicate += dup;
      await markSourceDiscovered(sb, source.id, raw_count, items.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ source_id: source.id, source_name: source.name, message: msg });
      await markSourceError(sb, source.id, msg);
    }
    if (i < sources.length - 1) await sleep(POLITE_DELAY_MS);
  }
  return result;
}

// Load discovered signals for a site, newest first, filtering out
// dismissed rows. Discovery output clustered by cluster_key before
// returning so the preview UI already sees deduped stories.
export async function loadActiveSignals(sb: SupabaseClient, siteSlug: AutopilotSiteSlug, limit = 50): Promise<DiscoveredSignal[]> {
  const { data } = await sb
    .from('network_autopilot_discovered_signals')
    .select('id, source_id, url, title, summary, published_at, retrieved_at, topic_keywords, cluster_key, network_autopilot_sources(name, domain, tier)')
    .eq('site_slug', siteSlug)
    .is('dismissed_at', null)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  const rows = ((data ?? []) as unknown) as Array<{
    id: string;
    source_id: string;
    url: string;
    title: string | null;
    summary: string | null;
    published_at: string | null;
    retrieved_at: string;
    topic_keywords: string[] | null;
    cluster_key: string | null;
    network_autopilot_sources: { name: string; domain: string; tier: 'official' | 'secondary' | 'community' } | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    source_id: r.source_id,
    source_name: r.network_autopilot_sources?.name ?? '',
    source_tier: r.network_autopilot_sources?.tier ?? 'community',
    domain: r.network_autopilot_sources?.domain ?? '',
    url: r.url,
    title: r.title ?? '(no title)',
    summary: r.summary,
    published_at: r.published_at,
    retrieved_at: r.retrieved_at,
    topic_keywords: r.topic_keywords ?? [],
    cluster_key: r.cluster_key,
  }));
}

// ─── Internal helpers ──────────────────────────────────────────

interface FeedItem { title: string; url: string; published_at: string | null; summary: string | null }
interface FetchSummary { items: FeedItem[]; raw_count: number }

async function fetchSourceSignals(source: SourceRow): Promise<FetchSummary> {
  // Manual sources contribute nothing; they only exist as reference
  // for operators or as a future hand-fed path.
  if (source.discovery_method === 'manual') return { items: [], raw_count: 0 };

  // listing_page: fetch a human page and extract anchor links as
  // signals. Used for official sources that don't publish a feed.
  if (source.discovery_method === 'listing_page') {
    const listingUrl = source.listing_url;
    if (!listingUrl) throw new Error('listing_page source missing listing_url');
    const html = await fetchText(listingUrl);
    const items = parseListingPageLinks(html, listingUrl).slice(0, MAX_ITEMS_PER_SOURCE);
    const retained = applyGameFilter(source, items);
    return { items: retained, raw_count: items.length };
  }

  // RSS / Atom path.
  if (source.discovery_method !== 'rss' && source.discovery_method !== 'atom') {
    return { items: [], raw_count: 0 };
  }
  const feedUrl = source.feed_url;
  if (!feedUrl) throw new Error('feed_url not configured');

  const text = await fetchText(feedUrl);
  const parsed = source.discovery_method === 'atom' ? parseAtom(text) : parseRss(text);
  if (parsed.length === 0) throw new Error('parse_error: feed body yielded 0 items (invalid XML or empty feed)');
  const filtered = applyGameFilter(source, parsed).slice(0, MAX_ITEMS_PER_SOURCE);
  return { items: filtered, raw_count: parsed.length };
}

// Only mixed-game feeds carry a `requires_game_filter` flag. YGO-
// dedicated sources skip the filter — fixes the "YGOPRODeck filtered
// to zero" bug.
function applyGameFilter(source: SourceRow, items: FeedItem[]): FeedItem[] {
  if (!source.requires_game_filter) return items;
  const re = /yu-?gi-?oh|ygo/i;
  return items.filter((i) => re.test(i.url) || re.test(i.title));
}

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.9, */*;q=0.5',
      },
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`fetch_error: ${resp.status} ${resp.statusText}`);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error(`fetch_error: response ${buf.byteLength} bytes exceeds ${MAX_RESPONSE_BYTES} cap`);
    }
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

// Deterministic listing-page extractor. Returns anchor links whose
// text looks like an article title (long enough, not navigation).
// Only used for sources configured with discovery_method='listing_page'.
function parseListingPageLinks(html: string, baseUrl: string): FeedItem[] {
  const base = new URL(baseUrl);
  // Strip global junk first — same as external-extraction.
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) != null) {
    const href = m[1]!;
    const text = m[2]!
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Discard obvious nav / short / anchor-fragment links.
    if (!text || text.length < 20 || text.length > 200) continue;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
    let abs = href;
    try {
      abs = new URL(href, base).toString();
    } catch {
      continue;
    }
    // Only keep links on the same host as the listing page — avoids
    // navigating off-site to random partners/ads.
    try {
      const u = new URL(abs);
      if (u.hostname !== base.hostname) continue;
      // Discard links that look like category hubs / pagination.
      if (/\/(category|tag|page|archive|author|login|register|search)\b/i.test(u.pathname)) continue;
      if (u.pathname === '/' || u.pathname === base.pathname) continue;
    } catch { continue; }
    if (seen.has(abs)) continue;
    seen.add(abs);
    items.push({ title: text, url: abs, published_at: null, summary: null });
    if (items.length >= MAX_ITEMS_PER_SOURCE * 2) break;
  }
  return items;
}

type PersistResult = 'inserted' | 'duplicate' | 'error';

async function persistSignal(sb: SupabaseClient, source: SourceRow, item: FeedItem): Promise<PersistResult> {
  const hash = crypto.createHash('sha256').update(item.url).digest('hex');
  const row = {
    source_id: source.id,
    site_slug: source.site_slug,
    signal_hash: hash,
    url: item.url,
    title: item.title,
    summary: item.summary,
    published_at: item.published_at,
    topic_keywords: extractKeywords(item.title),
    cluster_key: clusterKeyFor(item.title),
  };
  const { error } = await sb
    .from('network_autopilot_discovered_signals')
    .insert(row);
  if (error) {
    // 23505 = unique violation (same source + signal_hash).
    if (error.code === '23505') return 'duplicate';
    return 'error';
  }
  return 'inserted';
}

// ─── Minimal RSS / Atom parser ────────────────────────────────
//
// Not a general-purpose XML parser. Known failure modes:
//   * CDATA with HTML inside is stripped to plain text.
//   * Nested <item>/<entry> is not supported (feeds don't use it).
// Both are acceptable for the discovery use case. Replace with a
// proper XML parser (fast-xml-parser) when we need deeper fields.

function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) != null) {
    const block = m[1]!;
    const title = extractXmlField(block, 'title') ?? '';
    const link  = extractXmlField(block, 'link') ?? '';
    if (!title || !link) continue;
    const pubDate = extractXmlField(block, 'pubDate');
    const desc = extractXmlField(block, 'description');
    items.push({
      title: stripTags(title).trim(),
      url: link.trim(),
      published_at: pubDate ? toIso(pubDate) : null,
      summary: desc ? truncate(stripTags(desc).trim(), 500) : null,
    });
  }
  return items;
}

function parseAtom(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) != null) {
    const block = m[1]!;
    const title = extractXmlField(block, 'title') ?? '';
    // Atom links are self-closing with href.
    const linkMatch = /<link\b[^>]*href="([^"]+)"[^>]*\/?>/i.exec(block);
    const link = linkMatch?.[1] ?? '';
    if (!title || !link) continue;
    const updated = extractXmlField(block, 'updated') ?? extractXmlField(block, 'published');
    const summary = extractXmlField(block, 'summary') ?? extractXmlField(block, 'content');
    items.push({
      title: stripTags(title).trim(),
      url: link.trim(),
      published_at: updated ? toIso(updated) : null,
      summary: summary ? truncate(stripTags(summary).trim(), 500) : null,
    });
  }
  return items;
}

function extractXmlField(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(block);
  if (!m) return null;
  let v = m[1] ?? '';
  // Strip CDATA wrappers.
  v = v.replace(/<!\[CDATA\[/g, '').replace(/\]\]>/g, '');
  return v;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function toIso(s: string): string | null {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

// Keyword extraction: proper nouns + numbers. Minimal — refined later.
function extractKeywords(title: string | null | undefined): string[] {
  if (!title) return [];
  const tokens = title.split(/[^A-Za-z0-9']+/).filter((t) => t.length > 2);
  return Array.from(new Set(tokens.filter((t) => /^[A-Z]/.test(t) || /\d/.test(t)))).slice(0, 10);
}

// Cluster key: canonical stable hash of the top 3 significant tokens
// in the title. Identical cluster key = same story. Not perfect but
// good enough to collapse "YGOrganization — Blue-Eyes Reprint" and
// "Pojo — Blue-Eyes Reprint reports" into one cluster.
function clusterKeyFor(title: string | null | undefined): string | null {
  if (!title) return null;
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t))
    .sort()
    .slice(0, 4);
  if (tokens.length < 2) return null;
  return crypto.createHash('sha256').update(tokens.join('|')).digest('hex').slice(0, 16);
}

const STOPWORDS = new Set([
  'this', 'that', 'what', 'with', 'from', 'into', 'their', 'about', 'announced',
  'their', 'reveals', 'review', 'preview', 'news', 'post', 'posts', 'thread',
  'discussion', 'yugioh', 'yu-gi-oh', 'card', 'cards', 'set', 'sets',
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
