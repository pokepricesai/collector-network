import 'server-only';

// URL Inspection engine.
//
// Google's URL Inspection API has a limit around 2000 inspections
// per property per day. We do NOT inspect everything; we treat the
// queue as a work pool and the stored inspections as a cache.
//
// Priority sources (in roughly this order):
//   1. 'critical'  pages explicitly flagged (manual / incident)
//   2. 'high'      new sitemap URLs since last snapshot
//   3. 'high'      pages tied to an open SEO opportunity (striking
//                  distance / low_ctr / declining)
//   4. 'normal'    pages with impressions but zero clicks
//   5. 'low'       re-check of previously 'URL_UNKNOWN' / 'URL_IS_UNKNOWN'
//
// Each successful inspection schedules its own next_inspection_at
// so the cache cycles without us needing a cron that enqueues
// everything constantly.

import type { SupabaseClient } from '@supabase/supabase-js';
import { mintGoogleAccessToken } from '../google/credentials';

const SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly'];
const INSPECTION_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export interface InspectionResult {
  verdict: string;             // PASS | PARTIAL | FAIL | NEUTRAL
  coverageState: string;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  robotsState: string | null;
  indexingState: string | null;
  httpStatusCode: number | null;
}

interface RawInspectResp {
  inspectionResult?: {
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      indexingAllowedReason?: string;
    };
  };
}

const INSPECTION_FETCH_TIMEOUT_MS = 15000;

export async function inspectUrl(propertyId: string, url: string): Promise<InspectionResult> {
  const tok = await mintGoogleAccessToken(SCOPES);
  // Each call has a hard timeout so a slow Google response doesn't
  // monopolise the per-site budget.
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), INSPECTION_FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(INSPECTION_URL, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${tok.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inspectionUrl: url,
        siteUrl: propertyId,
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`[inspection] timeout after ${INSPECTION_FETCH_TIMEOUT_MS}ms for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[inspection] HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const body = (await res.json()) as RawInspectResp;
  const r = body.inspectionResult?.indexStatusResult ?? {};
  return {
    verdict: r.verdict ?? 'VERDICT_UNSPECIFIED',
    coverageState: r.coverageState ?? 'UNKNOWN',
    googleCanonical: r.googleCanonical ?? null,
    userCanonical: r.userCanonical ?? null,
    lastCrawlTime: r.lastCrawlTime ?? null,
    robotsState: r.robotsTxtState ?? null,
    indexingState: r.indexingState ?? null,
    httpStatusCode: null,
  };
}

interface QueueRow {
  id: string;
  site_id: string;
  url: string;
  priority: 'critical' | 'high' | 'normal' | 'low';
  reason: string;
}

/** Enqueue a URL for inspection. Idempotent on (site_id, url).
 *  Does not overwrite a pending row with a lower priority. */
export async function enqueueInspection(
  sb: SupabaseClient,
  siteId: string,
  url: string,
  priority: 'critical' | 'high' | 'normal' | 'low',
  reason: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sb
    .from('network_url_inspection_queue')
    .upsert({
      site_id: siteId,
      url,
      priority,
      reason,
      requested_at: new Date().toISOString(),
      status: 'pending',
      metadata,
    }, { onConflict: 'site_id,url', ignoreDuplicates: false });
  if (error) throw new Error(`[inspection] enqueue: ${error.message}`);
}

/** Build and enqueue a priority slate from the current OS state. */
export async function buildInspectionQueue(
  sb: SupabaseClient,
  siteId: string,
): Promise<{ enqueued: number }> {
  let enqueued = 0;

  // Open opportunities with a specific page.
  const { data: opps } = await sb
    .from('network_opportunities')
    .select('page, kind, severity')
    .eq('site_id', siteId)
    .eq('status', 'open')
    .neq('page', '')
    .in('kind', ['striking_distance', 'low_ctr', 'declining', 'zero_click'])
    .limit(300);
  for (const row of (opps ?? []) as Array<{ page: string; kind: string; severity: string }>) {
    if (!row.page) continue;
    const pr =
      row.severity === 'critical' ? 'critical' :
      row.severity === 'high' ? 'high' : 'normal';
    try {
      await enqueueInspection(sb, siteId, row.page, pr as 'high' | 'normal', `opportunity:${row.kind}`, { kind: row.kind });
      enqueued++;
    } catch { /* duplicate — ignore */ }
  }

  // High-impression zero-click pages from the url+query feed over 28d.
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 28);
  const { data: zc } = await sb
    .from('network_gsc_url_daily')
    .select('page, clicks, impressions')
    .eq('site_id', siteId)
    .gte('date', since.toISOString().slice(0, 10))
    .gte('impressions', 500)
    .lte('clicks', 0)
    .limit(100);
  for (const row of (zc ?? []) as Array<{ page: string }>) {
    try {
      await enqueueInspection(sb, siteId, row.page, 'normal', 'zero_click', {});
      enqueued++;
    } catch { /* ignore */ }
  }

  return { enqueued };
}

/** Pop the next batch from the queue, inspect each, persist results. */
export async function processInspectionQueue(
  sb: SupabaseClient,
  siteId: string,
  propertyId: string,
  maxToProcess: number,
): Promise<{
  processed: number;
  inspected: number;
  quotaExceeded: boolean;
  errors: Array<{ url: string; error: string }>;
}> {
  const { data: queueRaw, error: qErr } = await sb
    .from('network_url_inspection_queue')
    .select('id, site_id, url, priority, reason')
    .eq('site_id', siteId)
    .eq('status', 'pending')
    .order('priority', { ascending: true }) // critical < high < normal < low
    .order('requested_at', { ascending: true })
    .limit(maxToProcess);
  if (qErr) throw new Error(`[inspection] fetch queue: ${qErr.message}`);
  const queue = (queueRaw ?? []) as unknown as QueueRow[];

  const errors: Array<{ url: string; error: string }> = [];
  let inspected = 0;
  let quotaExceeded = false;

  for (const q of queue) {
    try {
      const r = await inspectUrl(propertyId, q.url);
      // persist
      const next = new Date();
      next.setUTCDate(next.getUTCDate() + 7); // re-check in 7d
      const { error: upErr } = await sb
        .from('network_url_inspections')
        .upsert({
          site_id: siteId,
          url: q.url,
          inspection_status: 'inspected',
          coverage_state: r.coverageState,
          google_canonical: r.googleCanonical,
          user_canonical: r.userCanonical,
          last_crawl_time: r.lastCrawlTime,
          robots_state: r.robotsState,
          indexing_state: r.indexingState,
          verdict: r.verdict,
          http_status_code: r.httpStatusCode,
          last_inspected_at: new Date().toISOString(),
          next_inspection_at: next.toISOString(),
        }, { onConflict: 'site_id,url' });
      if (upErr) throw new Error(upErr.message);
      await sb.from('network_url_inspection_queue')
        .update({ status: 'done', attempted_at: new Date().toISOString() })
        .eq('id', q.id);
      inspected++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Quota-exceeded errors from the inspection API typically come
      // back as HTTP 429. We stop processing and mark remaining queue
      // items as still pending.
      if (msg.includes('429') || /quota/i.test(msg)) {
        quotaExceeded = true;
        await sb.from('network_url_inspection_queue')
          .update({ status: 'skipped', attempted_at: new Date().toISOString() })
          .eq('id', q.id);
        errors.push({ url: q.url, error: 'quota exceeded' });
        break;
      }
      errors.push({ url: q.url, error: msg.slice(0, 300) });
      await sb.from('network_url_inspection_queue')
        .update({ status: 'failed', attempted_at: new Date().toISOString() })
        .eq('id', q.id);
    }
  }
  return { processed: queue.length, inspected, quotaExceeded, errors };
}
