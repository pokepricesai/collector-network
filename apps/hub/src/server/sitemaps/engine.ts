import 'server-only';

// Sitemap monitoring engine.
//
// For each site in the registry:
//   1. Fetch /robots.txt → discover declared Sitemap: URLs
//   2. Fall back to <canonical_url>/sitemap.xml if robots.txt
//      declares none
//   3. Parse the sitemap. If it's a sitemapindex, follow each
//      shard (<sitemap><loc>…</loc></sitemap>). Otherwise it's a
//      urlset.
//   4. Count submitted URLs.
//   5. Sample a bounded fraction of URLs (SAMPLE_URLS) and probe
//      each with HEAD → record redirects / 404s / 5xx.
//   6. Compute a structure_hash so a snapshot that didn't change
//      shape can be deduped on the admin UI.
//   7. Emit issues to network_sitemap_issues.
//
// Deliberately minimal XML parsing — pulls <loc> values with a
// regex rather than a full XML parser dependency. GSC-produced
// sitemaps are well-formed; this is enough for operational
// monitoring.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

const SAMPLE_URLS_PER_SHARD = 25;
const PROBE_TIMEOUT_MS = 10000;
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
}

interface FetchResult {
  ok: boolean;
  status: number | null;
  bytes: number;
  text: string;
  finalUrl: string;
  redirected: boolean;
}

async function fetchText(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<FetchResult> {
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
      ok: res.ok,
      status: res.status,
      bytes: text.length,
      text,
      finalUrl: res.url,
      redirected: res.url !== url,
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      bytes: 0,
      text: '',
      finalUrl: url,
      redirected: false,
    };
  } finally {
    clearTimeout(t);
  }
}

async function probeHead(url: string): Promise<{ status: number | null; redirected: boolean; finalUrl: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA },
    });
    return { status: res.status, redirected: res.url !== url, finalUrl: res.url };
  } catch {
    return { status: null, redirected: false, finalUrl: url };
  } finally {
    clearTimeout(t);
  }
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
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

function isIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

async function discoverSitemapRoots(canonicalUrl: string): Promise<{ roots: string[]; robotsStatus: number | null }> {
  const base = canonicalUrl.replace(/\/$/, '');
  const robots = await fetchText(`${base}/robots.txt`);
  const roots: string[] = [];
  if (robots.ok) {
    const lines = robots.text.split(/\r?\n/);
    for (const line of lines) {
      const m = /^\s*Sitemap:\s*(\S+)\s*$/i.exec(line);
      if (m && m[1]) roots.push(m[1]);
    }
  }
  if (roots.length === 0) {
    roots.push(`${base}/sitemap.xml`);
  }
  return { roots, robotsStatus: robots.status };
}

function sampleIndices(n: number, limit: number): number[] {
  if (n <= limit) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  const step = Math.max(1, Math.floor(n / limit));
  for (let i = 0; i < n && out.size < limit; i += step) out.add(i);
  // seed a few random indices too to catch tail-end issues
  while (out.size < limit) {
    out.add(Math.floor(Math.random() * n));
  }
  return [...out].sort((a, b) => a - b);
}

export async function runSitemapCheck(
  site: SiteDescriptor,
): Promise<SitemapResult> {
  const { roots, robotsStatus } = await discoverSitemapRoots(site.canonicalUrl);
  const issues: SitemapResult['issues'] = [];
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
      structureHash: 'empty',
      issues,
      errorSummary: 'no sitemap roots discovered',
      shards: [],
    };
  }

  // Use the first root as the canonical root. If multiple exist,
  // the others are treated as additional shards.
  const primary = roots[0]!;
  const rootRes = await fetchText(primary);
  if (!rootRes.ok) {
    issues.push({
      issue_type: 'shard_http_error',
      severity: 'error',
      shard_url: primary,
      http_status: rootRes.status,
      detail: `sitemap root returned ${rootRes.status ?? 'network-error'}`,
    });
    return {
      rootUrl: primary, rootStatus: rootRes.status, rootBytes: rootRes.bytes,
      shardCount: 0, submittedCount: 0, validSampled: 0,
      structureHash: 'root_error',
      issues,
      errorSummary: `root fetch failed: ${rootRes.status ?? 'network-error'}`,
      shards: [],
    };
  }

  // Gather shards.
  interface ShardDescriptor { url: string; urlCount: number; urls: string[] }
  const shards: ShardDescriptor[] = [];
  if (isIndex(rootRes.text)) {
    const shardUrls = parseLocs(rootRes.text);
    for (const shardUrl of shardUrls.slice(0, 50)) {
      const r = await fetchText(shardUrl);
      if (!r.ok) {
        issues.push({
          issue_type: 'shard_http_error',
          severity: 'error',
          shard_url: shardUrl,
          http_status: r.status,
          detail: `shard returned ${r.status ?? 'network-error'}`,
        });
        continue;
      }
      const urls = parseLocs(r.text);
      if (urls.length === 0) {
        issues.push({
          issue_type: 'empty_shard',
          severity: 'warning',
          shard_url: shardUrl,
          detail: 'shard parsed but contained zero <loc> entries',
        });
      }
      shards.push({ url: shardUrl, urlCount: urls.length, urls });
    }
    // Any additional sitemap roots declared in robots.txt beyond the
    // primary are treated as orphan shards for visibility.
    for (const extra of roots.slice(1, 10)) {
      issues.push({
        issue_type: 'orphan_shard',
        severity: 'info',
        shard_url: extra,
        detail: 'additional sitemap declared in robots.txt; not referenced by primary root',
      });
    }
  } else {
    // Single urlset — treat the root itself as the only shard.
    const urls = parseLocs(rootRes.text);
    shards.push({ url: primary, urlCount: urls.length, urls });
  }

  const submittedCount = shards.reduce((a, s) => a + s.urlCount, 0);

  // Duplicate detection across shards.
  const seen = new Map<string, number>();
  for (const s of shards) {
    for (const u of s.urls) seen.set(u, (seen.get(u) ?? 0) + 1);
  }
  for (const [u, n] of seen) {
    if (n > 1) {
      issues.push({
        issue_type: 'duplicate_url',
        severity: 'warning',
        url: u,
        evidence: { occurrence_count: n },
        detail: `URL appears in ${n} shards`,
      });
    }
  }

  // Wrong-host detection: any URL whose origin disagrees with the
  // canonical URL origin is flagged.
  const canonicalOrigin = new URL(site.canonicalUrl).origin.replace(/\/$/, '');
  for (const [u] of seen) {
    try {
      const originCheck = new URL(u).origin;
      if (originCheck !== canonicalOrigin
          && originCheck.replace('www.', '') !== canonicalOrigin.replace('www.', '')) {
        issues.push({
          issue_type: 'wrong_host',
          severity: 'warning',
          url: u,
          detail: `expected origin ${canonicalOrigin}, got ${originCheck}`,
        });
      }
    } catch {
      issues.push({
        issue_type: 'malformed_url',
        severity: 'warning',
        url: u,
        detail: 'URL did not parse',
      });
    }
  }

  // Sample URLs across shards and HEAD-probe them.
  let validSampled = 0;
  for (const s of shards) {
    const idxs = sampleIndices(s.urls.length, SAMPLE_URLS_PER_SHARD);
    for (const i of idxs) {
      const u = s.urls[i]!;
      const r = await probeHead(u);
      if (r.status == null) {
        issues.push({ issue_type: 'url_network_error', severity: 'warning', url: u, shard_url: s.url });
        continue;
      }
      if (r.status >= 400) {
        issues.push({
          issue_type: 'url_http_error',
          severity: r.status >= 500 ? 'error' : 'warning',
          url: u, shard_url: s.url, http_status: r.status,
        });
        continue;
      }
      if (r.redirected) {
        issues.push({
          issue_type: 'redirects',
          severity: 'info',
          url: u, shard_url: s.url,
          http_status: r.status,
          detail: `redirected to ${r.finalUrl}`,
        });
      }
      validSampled++;
    }
  }

  const hashInput = [
    primary,
    ...shards.map((s) => `${s.url}:${s.urlCount}`),
  ].join('|');
  const structureHash = createHash('sha256').update(hashInput).digest('hex').slice(0, 16);

  return {
    rootUrl: primary,
    rootStatus: rootRes.status,
    rootBytes: rootRes.bytes,
    shardCount: shards.length,
    submittedCount,
    validSampled,
    structureHash,
    issues,
    errorSummary: null,
    shards: shards.map((s) => ({ url: s.url, urlCount: s.urlCount })),
  };
}

export async function recordSitemapSnapshot(
  sb: SupabaseClient,
  site: SiteDescriptor,
  res: SitemapResult,
): Promise<{ snapshotId: string }> {
  const errorCount = res.issues.filter((i) => i.severity === 'error').length;
  const warningCount = res.issues.filter((i) => i.severity === 'warning').length;
  const status: 'ok' | 'warning' | 'error' =
    errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok';

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
      metadata: { shards: res.shards },
    })
    .select('id')
    .single();
  if (error) throw new Error(`[sitemap] record snapshot: ${error.message}`);
  const snapshotId = (data as { id: string }).id;

  if (res.issues.length > 0) {
    const toInsert = res.issues.map((i) => ({
      snapshot_id: snapshotId,
      site_id: site.id,
      issue_type: i.issue_type,
      severity: i.severity,
      url: i.url ?? null,
      shard_url: i.shard_url ?? null,
      http_status: i.http_status ?? null,
      detail: i.detail ?? null,
      evidence: i.evidence ?? {},
    }));
    const CHUNK = 500;
    for (let s = 0; s < toInsert.length; s += CHUNK) {
      const { error: iErr } = await sb
        .from('network_sitemap_issues')
        .insert(toInsert.slice(s, s + CHUNK));
      if (iErr) throw new Error(`[sitemap] insert issues: ${iErr.message}`);
    }
  }
  return { snapshotId };
}

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
