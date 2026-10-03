import 'server-only';

// Sitemap monitoring engine.
//
// Hard operational budget:
//   • Each HTTP fetch: 7s hard timeout (AbortController)
//   • Each HEAD probe: 5s hard timeout
//   • HEAD probes within a site run with bounded concurrency (6)
//   • Overall per-site watchdog: 55s — if we overrun, we persist
//     what we have, record a timeout issue, and move on.
//   • Shard count capped at 40 (production sitemaps shouldn't need more)
//
// XML parsing is deliberately regex-based — GSC-produced sitemaps
// are well-formed; this is operational monitoring, not strict
// XML validation.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const FETCH_TIMEOUT_MS   = 7000;
const PROBE_TIMEOUT_MS   = 5000;
const PROBE_CONCURRENCY  = 6;
const SAMPLE_URLS_PER_SHARD = 20;
const MAX_SHARDS         = 40;
const PER_SITE_BUDGET_MS = 55000;
const UA = 'Collector-Network-OS Sitemap Monitor (+https://pokeprices.io)';

export interface SiteDescriptor {
  id: string;
  slug: string;
  canonicalUrl: string;
}

interface SitemapResult {
  rootUrl: string;
  rootStatus: number | null;
  rootBytes: number;
  shardCount: number;
  submittedCount: number;
  validSampled: number;
  structureHash: string;
  issues: Array<{
    issue_type: string;
    severity: 'info' | 'warning' | 'error';
    url?: string | null;
    shard_url?: string | null;
    http_status?: number | null;
    detail?: string;
    evidence?: Record<string, unknown>;
  }>;
  errorSummary: string | null;
  shards: Array<{ url: string; urlCount: number }>;
  durationMs: number;
  budgetExceeded: boolean;
}

interface FetchResult {
  ok: boolean;
  status: number | null;
  bytes: number;
  text: string;
  finalUrl: string;
  redirected: boolean;
  timedOut: boolean;
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<FetchResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/xml, application/xml, text/plain, */*' },
    });
    const text = await res.text();
    return {
      ok: res.ok, status: res.status, bytes: text.length, text,
      finalUrl: res.url, redirected: res.url !== url, timedOut: false,
    };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'AbortError';
    return { ok: false, status: null, bytes: 0, text: '', finalUrl: url, redirected: false, timedOut };
  } finally {
    clearTimeout(t);
  }
}

interface ProbeResult { status: number | null; redirected: boolean; finalUrl: string; timedOut: boolean }

async function probeHead(url: string): Promise<ProbeResult> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD', signal: ctl.signal, redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    return { status: res.status, redirected: res.url !== url, finalUrl: res.url, timedOut: false };
  } catch (err) {
    return { status: null, redirected: false, finalUrl: url, timedOut: err instanceof Error && err.name === 'AbortError' };
  } finally {
    clearTimeout(t);
  }
}

/** Bounded-concurrency map. */
async function parallelMap<T, R>(items: T[], concurrency: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

function parseLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const raw = (m[1] ?? '').trim();
    if (raw) out.push(decodeHtmlEntities(raw));
  }
  return out;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

function isIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function discoverSitemapRoots(canonicalUrl: string): Promise<{ roots: string[]; robotsStatus: number | null }> {
  const base = canonicalUrl.replace(/\/$/, '');
  const robots = await fetchText(`${base}/robots.txt`);
  const roots: string[] = [];
  if (robots.ok) {
    for (const line of robots.text.split(/\r?\n/)) {
      const m = /^\s*Sitemap:\s*(\S+)\s*$/i.exec(line);
      if (m && m[1]) roots.push(m[1]);
    }
  }
  if (roots.length === 0) roots.push(`${base}/sitemap.xml`);
  return { roots, robotsStatus: robots.status };
}

function sampleIndices(n: number, limit: number): number[] {
  if (n <= limit) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  const step = Math.max(1, Math.floor(n / limit));
  for (let i = 0; i < n && out.size < limit; i += step) out.add(i);
  while (out.size < limit) out.add(Math.floor(Math.random() * n));
  return [...out].sort((a, b) => a - b);
}

/**
 * Run the sitemap check for ONE site. Each stage checks the elapsed
 * budget; if we're close to the limit we persist a partial snapshot
 * with a timeout issue rather than letting Vercel kill the invocation.
 */
export async function runSitemapCheck(site: SiteDescriptor): Promise<SitemapResult> {
  const started = Date.now();
  const budgetLeftMs = () => PER_SITE_BUDGET_MS - (Date.now() - started);
  const issues: SitemapResult['issues'] = [];

  const { roots, robotsStatus } = await discoverSitemapRoots(site.canonicalUrl);
  if (robotsStatus === null || robotsStatus >= 400) {
    issues.push({
      issue_type: 'robots_txt_unreachable',
      severity: 'warning',
      detail: `robots.txt returned ${robotsStatus ?? 'network-error'} — falling back to /sitemap.xml`,
    });
  }

  if (roots.length === 0) {
    return {
      rootUrl: `${site.canonicalUrl}/sitemap.xml`,
      rootStatus: null, rootBytes: 0, shardCount: 0,
      submittedCount: 0, validSampled: 0,
      structureHash: 'empty', issues,
      errorSummary: 'no sitemap roots discovered', shards: [],
      durationMs: Date.now() - started, budgetExceeded: false,
    };
  }

  const primary = roots[0]!;
  const rootRes = await fetchText(primary);
  if (!rootRes.ok) {
    issues.push({
      issue_type: rootRes.timedOut ? 'root_timeout' : 'shard_http_error',
      severity: 'error',
      shard_url: primary,
      http_status: rootRes.status,
      detail: `sitemap root ${rootRes.timedOut ? 'timed out' : `returned ${rootRes.status ?? 'network-error'}`}`,
    });
    return {
      rootUrl: primary, rootStatus: rootRes.status, rootBytes: rootRes.bytes,
      shardCount: 0, submittedCount: 0, validSampled: 0,
      structureHash: 'root_error', issues,
      errorSummary: `root fetch failed: ${rootRes.timedOut ? 'timeout' : rootRes.status ?? 'network-error'}`,
      shards: [], durationMs: Date.now() - started, budgetExceeded: false,
    };
  }

  interface ShardDescriptor { url: string; urlCount: number; urls: string[] }
  const shards: ShardDescriptor[] = [];
  if (isIndex(rootRes.text)) {
    const allShardUrls = parseLocs(rootRes.text);
    const shardUrls = allShardUrls.slice(0, MAX_SHARDS);
    if (allShardUrls.length > MAX_SHARDS) {
      issues.push({
        issue_type: 'too_many_shards',
        severity: 'warning',
        detail: `sitemap declares ${allShardUrls.length} shards; capped at ${MAX_SHARDS} for monitoring`,
      });
    }
    for (const shardUrl of shardUrls) {
      if (budgetLeftMs() < 10000) {
        issues.push({ issue_type: 'budget_exceeded_shards', severity: 'warning', detail: `per-site budget tight; skipped remaining shards`, shard_url: shardUrl });
        break;
      }
      const r = await fetchText(shardUrl);
      if (!r.ok) {
        issues.push({
          issue_type: r.timedOut ? 'shard_timeout' : 'shard_http_error',
          severity: 'error',
          shard_url: shardUrl, http_status: r.status,
          detail: r.timedOut ? 'shard fetch timed out' : `shard returned ${r.status ?? 'network-error'}`,
        });
        continue;
      }
      const urls = parseLocs(r.text);
      if (urls.length === 0) {
        issues.push({ issue_type: 'empty_shard', severity: 'warning', shard_url: shardUrl, detail: 'shard parsed but contained zero <loc> entries' });
      }
      shards.push({ url: shardUrl, urlCount: urls.length, urls });
    }
    for (const extra of roots.slice(1, 10)) {
      issues.push({ issue_type: 'orphan_shard', severity: 'info', shard_url: extra, detail: 'additional sitemap declared in robots.txt; not referenced by primary root' });
    }
  } else {
    const urls = parseLocs(rootRes.text);
    shards.push({ url: primary, urlCount: urls.length, urls });
  }

  const submittedCount = shards.reduce((a, s) => a + s.urlCount, 0);

  // Dedup detection + wrong-host detection (cheap, in-memory).
  const seen = new Map<string, number>();
  for (const s of shards) for (const u of s.urls) seen.set(u, (seen.get(u) ?? 0) + 1);
  for (const [u, n] of seen) if (n > 1) {
    issues.push({ issue_type: 'duplicate_url', severity: 'warning', url: u, evidence: { occurrence_count: n }, detail: `URL appears in ${n} shards` });
  }
  const canonicalOrigin = new URL(site.canonicalUrl).origin.replace(/\/$/, '');
  for (const [u] of seen) {
    try {
      const o = new URL(u).origin;
      if (o !== canonicalOrigin && o.replace('www.', '') !== canonicalOrigin.replace('www.', '')) {
        issues.push({ issue_type: 'wrong_host', severity: 'warning', url: u, detail: `expected origin ${canonicalOrigin}, got ${o}` });
      }
    } catch {
      issues.push({ issue_type: 'malformed_url', severity: 'warning', url: u, detail: 'URL did not parse' });
    }
  }

  // Sample URLs across shards, probe them in parallel.
  const toProbe: Array<{ shardUrl: string; url: string }> = [];
  for (const s of shards) {
    const idxs = sampleIndices(s.urls.length, SAMPLE_URLS_PER_SHARD);
    for (const i of idxs) toProbe.push({ shardUrl: s.url, url: s.urls[i]! });
  }
  // If budget tight, trim probes.
  const probeMsNeededEstimate = (toProbe.length / PROBE_CONCURRENCY) * PROBE_TIMEOUT_MS;
  if (probeMsNeededEstimate > budgetLeftMs() * 0.8) {
    const keep = Math.max(5, Math.floor(toProbe.length * (budgetLeftMs() * 0.8) / Math.max(1, probeMsNeededEstimate)));
    if (keep < toProbe.length) {
      issues.push({ issue_type: 'budget_exceeded_probes', severity: 'info', detail: `budget tight; sampled ${keep}/${toProbe.length} URLs for HTTP probing` });
      toProbe.length = keep;
    }
  }
  const probeResults = await parallelMap(toProbe, PROBE_CONCURRENCY, (p) => probeHead(p.url));
  let validSampled = 0;
  for (let i = 0; i < toProbe.length; i++) {
    const p = toProbe[i]!; const r = probeResults[i]!;
    if (r.status == null) {
      issues.push({ issue_type: r.timedOut ? 'url_timeout' : 'url_network_error', severity: 'warning', url: p.url, shard_url: p.shardUrl });
      continue;
    }
    if (r.status >= 400) {
      issues.push({ issue_type: 'url_http_error', severity: r.status >= 500 ? 'error' : 'warning', url: p.url, shard_url: p.shardUrl, http_status: r.status });
      continue;
    }
    if (r.redirected) {
      issues.push({ issue_type: 'redirects', severity: 'info', url: p.url, shard_url: p.shardUrl, http_status: r.status, detail: `redirected to ${r.finalUrl}` });
    }
    validSampled++;
  }

  const hashInput = [primary, ...shards.map((s) => `${s.url}:${s.urlCount}`)].join('|');
  const structureHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  return {
    rootUrl: primary,
    rootStatus: rootRes.status,
    rootBytes: rootRes.bytes,
    shardCount: shards.length,
    submittedCount, validSampled, structureHash, issues,
    errorSummary: null,
    shards: shards.map((s) => ({ url: s.url, urlCount: s.urlCount })),
    durationMs: Date.now() - started,
    budgetExceeded: budgetLeftMs() < 0,
  };
}

export async function recordSitemapSnapshot(
  sb: SupabaseClient,
  site: SiteDescriptor,
  res: SitemapResult,
): Promise<{ snapshotId: string }> {
  const errorCount = res.issues.filter((i) => i.severity === 'error').length;
  const warningCount = res.issues.filter((i) => i.severity === 'warning').length;
  const status: 'ok' | 'warning' | 'error' = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok';

  const { data, error } = await sb
    .from('network_sitemap_snapshots')
    .insert({
      site_id: site.id,
      root_url: res.rootUrl,
      root_status: res.rootStatus,
      root_bytes: res.rootBytes,
      shard_count: res.shardCount,
      submitted_count: res.submittedCount,
      valid_sampled: res.validSampled,
      issue_count: res.issues.length,
      structure_hash: res.structureHash,
      status,
      error_summary: res.errorSummary,
      metadata: { shards: res.shards, duration_ms: res.durationMs, budget_exceeded: res.budgetExceeded },
    })
    .select('id').single();
  if (error) throw new Error(`[sitemap] record snapshot: ${error.message}`);
  const snapshotId = (data as { id: string }).id;

  if (res.issues.length > 0) {
    const toInsert = res.issues.map((i) => ({
      snapshot_id: snapshotId, site_id: site.id,
      issue_type: i.issue_type, severity: i.severity,
      url: i.url ?? null, shard_url: i.shard_url ?? null,
      http_status: i.http_status ?? null, detail: i.detail ?? null,
      evidence: i.evidence ?? {},
    }));
    const CHUNK = 500;
    for (let s = 0; s < toInsert.length; s += CHUNK) {
      const { error: iErr } = await sb.from('network_sitemap_issues').insert(toInsert.slice(s, s + CHUNK));
      if (iErr) throw new Error(`[sitemap] insert issues: ${iErr.message}`);
    }
  }
  return { snapshotId };
}

/** Legacy multi-site runner — kept for the nightly cron that
 *  processes everything via /api/sync/sitemaps. Admin-triggered
 *  manual runs now go per-site via the registry. */
export async function runSitemapsForAllSites(
  sb: SupabaseClient,
  sites: SiteDescriptor[],
): Promise<{ snapshots: Array<{ site: string; snapshotId: string; result: SitemapResult }>; errors: Array<{ site: string; error: string }> }> {
  const snapshots: Array<{ site: string; snapshotId: string; result: SitemapResult }> = [];
  const errors: Array<{ site: string; error: string }> = [];
  for (const site of sites) {
    try {
      const result = await runSitemapCheck(site);
      const { snapshotId } = await recordSitemapSnapshot(sb, site, result);
      snapshots.push({ site: site.slug, snapshotId, result });
    } catch (err) {
      errors.push({ site: site.slug, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { snapshots, errors };
}
