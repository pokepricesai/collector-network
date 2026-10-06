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
import { listEnabledSources, markSourceDiscovered, type SourceRow } from './sources';

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
      const signals = await fetchSourceSignals(source);
      result.sources_scanned += 1;
      result.signals_found += signals.length;
      let inserted = 0;
      let dup = 0;
      for (const sig of signals) {
        const ok = await persistSignal(sb, source, sig);
        if (ok === 'inserted') inserted += 1;
        else if (ok === 'duplicate') dup += 1;
      }
      result.signals_inserted += inserted;
      result.signals_skipped_duplicate += dup;
      await markSourceDiscovered(sb, source.id, signals.length);
    } catch (err) {
      result.errors.push({ source_id: source.id, source_name: source.name, message: err instanceof Error ? err.message : String(err) });
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

async function fetchSourceSignals(source: SourceRow): Promise<FeedItem[]> {
  if (source.discovery_method !== 'rss' && source.discovery_method !== 'atom') {
    // sitemap / manual methods land in later checkpoints.
    return [];
  }
  const feedUrl = source.feed_url;
  if (!feedUrl) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let text = '';
  try {
    const resp = await fetch(feedUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      },
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw new Error(`response ${buf.byteLength} bytes exceeds ${MAX_RESPONSE_BYTES} cap`);
    text = new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }

  const items = source.discovery_method === 'atom' ? parseAtom(text) : parseRss(text);
  // Light filter: for multi-game feeds like TCGplayer Infinite, keep
  // only items whose URL or title mentions Yu-Gi-Oh so we don't
  // pollute the YGO queue with unrelated games.
  const filtered = source.site_slug === 'ygo'
    ? items.filter((i) => /yu-?gi-?oh|ygo/i.test(i.url) || /yu-?gi-?oh|ygo/i.test(i.title))
    : items;
  return filtered.slice(0, MAX_ITEMS_PER_SOURCE);
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
