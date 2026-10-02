import 'server-only';

// GSC + GA4 sync orchestrator. Service-role Supabase writes;
// strictly RLS-bypass. Only invoked from cron routes that have
// already verified CRON_SECRET.
//
// Design:
//   • Each sync run is tracked in network_job_runs. We call the
//     network_start_job_run / complete / fail RPCs so operators
//     see runs in /admin/health and health badges populate.
//   • GSC: a sliding window re-fetches recent days to absorb
//     GSC's reporting lag. Rows are upserted on their natural
//     unique key so day-level overwrites are safe.
//   • GA4: same window-slide semantics.
//   • Property registry carries last_data_date; after a successful
//     run, we update it to the newest date we observed rows for.

import type { SupabaseClient } from '@supabase/supabase-js';
import { gscQueryAll } from './gsc';
import { ga4RunReport } from './ga4';

export interface GooglePropertyRow {
  id: string;
  site_id: string;
  kind: 'gsc' | 'ga4';
  property_id: string;
  display_name: string | null;
  backfill_from: string | null;
  last_data_date: string | null;
}

interface SiteSlugRow { id: string; slug: string }

const GSC_SETTLE_LAG_DAYS = 3; // GSC data is unreliable within last 3 days
const GSC_INCREMENTAL_WINDOW_DAYS = 7; // always re-fetch last 7 days
const GA4_INCREMENTAL_WINDOW_DAYS = 3;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dateMinusDays(d: Date, days: number): Date {
  const n = new Date(d);
  n.setUTCDate(n.getUTCDate() - days);
  return n;
}

export async function loadActiveProperties(
  sb: SupabaseClient,
  kind: 'gsc' | 'ga4',
  siteSlug?: string,
): Promise<Array<GooglePropertyRow & { slug: string }>> {
  const { data, error } = await sb
    .from('network_google_properties')
    .select('id, site_id, kind, property_id, display_name, backfill_from, last_data_date, network_sites!inner(slug)')
    .eq('kind', kind)
    .eq('status', 'active');
  if (error) throw new Error(`[sync] load properties: ${error.message}`);
  type Row = GooglePropertyRow & { network_sites: { slug: string } };
  const rows = (data ?? []) as unknown as Row[];
  const mapped = rows.map((r) => ({
    id: r.id,
    site_id: r.site_id,
    kind: r.kind,
    property_id: r.property_id,
    display_name: r.display_name,
    backfill_from: r.backfill_from,
    last_data_date: r.last_data_date,
    slug: r.network_sites.slug,
  }));
  return siteSlug ? mapped.filter((p) => p.slug === siteSlug) : mapped;
}

// --- Job-run wrappers ---------------------------------------------
async function startJob(
  sb: SupabaseClient,
  jobName: string,
  siteId: string | null,
  metadata: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await sb.rpc('network_start_job_run', {
    p_job_name: jobName,
    p_job_type: 'sync',
    p_site_id: siteId,
    p_metadata: metadata as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(`[sync] start job: ${error.message}`);
  return data as string;
}

async function completeJob(
  sb: SupabaseClient,
  id: string,
  rowsExamined: number,
  rowsInserted: number,
  rowsUpdated: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.rpc('network_complete_job_run', {
    p_id: id,
    p_status: 'success',
    p_rows_examined: rowsExamined,
    p_rows_inserted: rowsInserted,
    p_rows_updated: rowsUpdated,
    p_rows_rejected: 0,
    p_error_summary: null,
    p_metadata: metadata as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(`[sync] complete job: ${error.message}`);
}

async function failJob(sb: SupabaseClient, id: string, msg: string): Promise<void> {
  await sb.rpc('network_fail_job_run', {
    p_id: id,
    p_error_summary: msg.slice(0, 500),
    p_metadata: null as unknown as Record<string, unknown>,
  });
}

// --- Window computation -------------------------------------------
export function gscWindow(prop: GooglePropertyRow, today: Date): { start: string; end: string } {
  const end = dateMinusDays(today, GSC_SETTLE_LAG_DAYS);
  // Start from max(backfill_from, last_data_date - window + 1). If
  // nothing synced yet, fall back to backfill_from (or 90d ago).
  let start = dateMinusDays(end, GSC_INCREMENTAL_WINDOW_DAYS - 1);
  if (!prop.last_data_date) {
    const fallback = prop.backfill_from ?? iso(dateMinusDays(today, 90));
    start = new Date(fallback) < start ? new Date(fallback) : start;
  } else {
    const lastDate = new Date(prop.last_data_date);
    const slideStart = dateMinusDays(lastDate, GSC_INCREMENTAL_WINDOW_DAYS - 1);
    start = slideStart < start ? slideStart : start;
  }
  return { start: iso(start), end: iso(end) };
}

export function ga4Window(prop: GooglePropertyRow, today: Date): { start: string; end: string } {
  const end = dateMinusDays(today, 1); // GA4 "yesterday"
  let start = dateMinusDays(end, GA4_INCREMENTAL_WINDOW_DAYS - 1);
  if (!prop.last_data_date) {
    const fallback = prop.backfill_from ?? iso(dateMinusDays(today, 90));
    start = new Date(fallback) < start ? new Date(fallback) : start;
  } else {
    const lastDate = new Date(prop.last_data_date);
    const slideStart = dateMinusDays(lastDate, GA4_INCREMENTAL_WINDOW_DAYS - 1);
    start = slideStart < start ? slideStart : start;
  }
  return { start: iso(start), end: iso(end) };
}

// --- GSC sync -----------------------------------------------------
export async function syncGscProperty(
  sb: SupabaseClient,
  prop: GooglePropertyRow,
  startDate: string,
  endDate: string,
): Promise<{
  site_daily: number;
  url_daily: number;
  query_daily: number;
  url_query_daily: number;
  latest_date: string | null;
}> {
  // Site-level daily (date dimension only — gives site totals + avg position).
  const siteRows = await gscQueryAll(prop.property_id, startDate, endDate, ['date']);
  // URL-level daily (date + page).
  const urlRows = await gscQueryAll(prop.property_id, startDate, endDate, ['date', 'page']);
  // Query-level daily (date + query).
  const queryRows = await gscQueryAll(prop.property_id, startDate, endDate, ['date', 'query']);
  // URL + query combined (opportunity engine feed). Capped by GSC rowLimit at 25k/day inherently.
  const urlQueryRows = await gscQueryAll(prop.property_id, startDate, endDate, ['date', 'page', 'query']);

  // Build "pages with impressions / clicks" cardinalities from url rows per date.
  const pagesPerDate = new Map<string, { withImp: Set<string>; withClick: Set<string> }>();
  for (const r of urlRows) {
    if (!r.date || !r.page) continue;
    let entry = pagesPerDate.get(r.date);
    if (!entry) {
      entry = { withImp: new Set(), withClick: new Set() };
      pagesPerDate.set(r.date, entry);
    }
    if (r.impressions > 0) entry.withImp.add(r.page);
    if (r.clicks > 0) entry.withClick.add(r.page);
  }

  const site_daily_rows = siteRows.map((r) => ({
    site_id: prop.site_id,
    date: r.date,
    clicks: r.clicks,
    impressions: r.impressions,
    position_avg: r.position,
    pages_with_impressions: pagesPerDate.get(r.date)?.withImp.size ?? 0,
    pages_with_clicks: pagesPerDate.get(r.date)?.withClick.size ?? 0,
  }));
  const url_daily_rows = urlRows.filter((r) => r.date && r.page).map((r) => ({
    site_id: prop.site_id,
    date: r.date,
    page: r.page!,
    clicks: r.clicks,
    impressions: r.impressions,
    position_avg: r.position,
  }));
  const query_daily_rows = queryRows.filter((r) => r.date && r.query).map((r) => ({
    site_id: prop.site_id,
    date: r.date,
    query: r.query!,
    clicks: r.clicks,
    impressions: r.impressions,
    position_avg: r.position,
  }));
  const url_query_daily_rows = urlQueryRows.filter((r) => r.date && r.page && r.query).map((r) => ({
    site_id: prop.site_id,
    date: r.date,
    page: r.page!,
    query: r.query!,
    clicks: r.clicks,
    impressions: r.impressions,
    position_avg: r.position,
  }));

  async function upsert(table: string, rows: unknown[], onConflict: string) {
    if (rows.length === 0) return;
    // Chunk at 1000 to stay under Supabase payload limits.
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error } = await sb.from(table).upsert(slice as never, { onConflict });
      if (error) throw new Error(`[sync/gsc] upsert ${table}: ${error.message}`);
    }
  }

  await upsert('network_gsc_site_daily', site_daily_rows, 'site_id,date');
  await upsert('network_gsc_url_daily', url_daily_rows, 'site_id,date,page');
  await upsert('network_gsc_query_daily', query_daily_rows, 'site_id,date,query');
  await upsert('network_gsc_url_query_daily', url_query_daily_rows, 'site_id,date,page,query');

  const latest = siteRows.reduce<string | null>((acc, r) => (!acc || r.date > acc ? r.date : acc), null);
  return {
    site_daily: site_daily_rows.length,
    url_daily: url_daily_rows.length,
    query_daily: query_daily_rows.length,
    url_query_daily: url_query_daily_rows.length,
    latest_date: latest,
  };
}

export async function syncAllGsc(sb: SupabaseClient, today: Date): Promise<{
  properties: number;
  totals: { site_daily: number; url_daily: number; query_daily: number; url_query_daily: number };
  errors: Array<{ property: string; error: string }>;
}> {
  const props = await loadActiveProperties(sb, 'gsc');
  const totals = { site_daily: 0, url_daily: 0, query_daily: 0, url_query_daily: 0 };
  const errors: Array<{ property: string; error: string }> = [];
  for (const p of props) {
    const w = gscWindow(p, today);
    const jobId = await startJob(sb, 'gsc.incremental', p.site_id, {
      property_id: p.property_id, start: w.start, end: w.end,
    });
    try {
      const r = await syncGscProperty(sb, p, w.start, w.end);
      totals.site_daily += r.site_daily;
      totals.url_daily += r.url_daily;
      totals.query_daily += r.query_daily;
      totals.url_query_daily += r.url_query_daily;
      if (r.latest_date) {
        await sb.from('network_google_properties').update({
          last_sync_at: new Date().toISOString(),
          last_data_date: r.latest_date,
        }).eq('id', p.id);
      }
      await completeJob(sb, jobId, r.site_daily + r.url_daily + r.query_daily + r.url_query_daily, r.site_daily + r.url_daily + r.query_daily + r.url_query_daily, 0, {
        property_id: p.property_id, latest_date: r.latest_date,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(sb, jobId, msg);
      errors.push({ property: p.property_id, error: msg });
    }
  }
  // Flip integrations to connected if we have at least one success.
  if (errors.length < props.length) {
    await sb.from('network_integrations').update({
      status: 'connected',
      last_success_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      error_summary: null,
    }).eq('provider', 'gsc');
  }
  return { properties: props.length, totals, errors };
}

// --- GA4 sync -----------------------------------------------------
export async function syncGa4Property(
  sb: SupabaseClient,
  prop: GooglePropertyRow,
  startDate: string,
  endDate: string,
): Promise<{ rows: number; latest_date: string | null }> {
  const rows = await ga4RunReport(prop.property_id, startDate, endDate);
  const dbRows = rows.map((r) => ({
    site_id: prop.site_id,
    date: r.date,
    active_users: r.activeUsers,
    new_users: r.newUsers,
    sessions: r.sessions,
    engaged_sessions: r.engagedSessions,
    avg_session_duration: r.averageSessionDuration,
    screen_page_views: r.screenPageViews,
  }));
  if (dbRows.length > 0) {
    const CHUNK = 1000;
    for (let i = 0; i < dbRows.length; i += CHUNK) {
      const slice = dbRows.slice(i, i + CHUNK);
      const { error } = await sb
        .from('network_ga4_site_daily')
        .upsert(slice as never, { onConflict: 'site_id,date' });
      if (error) throw new Error(`[sync/ga4] upsert: ${error.message}`);
    }
  }
  const latest = rows.reduce<string | null>((acc, r) => (!acc || r.date > acc ? r.date : acc), null);
  return { rows: dbRows.length, latest_date: latest };
}

export async function syncAllGa4(sb: SupabaseClient, today: Date): Promise<{
  properties: number;
  totals: { rows: number };
  errors: Array<{ property: string; error: string }>;
}> {
  const props = await loadActiveProperties(sb, 'ga4');
  const totals = { rows: 0 };
  const errors: Array<{ property: string; error: string }> = [];
  for (const p of props) {
    const w = ga4Window(p, today);
    const jobId = await startJob(sb, 'ga4.incremental', p.site_id, {
      property_id: p.property_id, start: w.start, end: w.end,
    });
    try {
      const r = await syncGa4Property(sb, p, w.start, w.end);
      totals.rows += r.rows;
      if (r.latest_date) {
        await sb.from('network_google_properties').update({
          last_sync_at: new Date().toISOString(),
          last_data_date: r.latest_date,
        }).eq('id', p.id);
      }
      await completeJob(sb, jobId, r.rows, r.rows, 0, {
        property_id: p.property_id, latest_date: r.latest_date,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await failJob(sb, jobId, msg);
      errors.push({ property: p.property_id, error: msg });
    }
  }
  if (errors.length < props.length) {
    await sb.from('network_integrations').update({
      status: 'connected',
      last_success_at: new Date().toISOString(),
      last_attempt_at: new Date().toISOString(),
      error_summary: null,
    }).eq('provider', 'ga4');
  }
  return { properties: props.length, totals, errors };
}

// --- Backfill wrappers --------------------------------------------
export async function backfillGscProperty(
  sb: SupabaseClient,
  prop: GooglePropertyRow,
  today: Date,
): Promise<{ site_daily: number; url_daily: number; query_daily: number; url_query_daily: number; latest_date: string | null }> {
  const end = dateMinusDays(today, GSC_SETTLE_LAG_DAYS);
  const start = prop.backfill_from ? new Date(prop.backfill_from) : dateMinusDays(end, 90);
  return syncGscProperty(sb, prop, iso(start), iso(end));
}

export async function backfillGa4Property(
  sb: SupabaseClient,
  prop: GooglePropertyRow,
  today: Date,
): Promise<{ rows: number; latest_date: string | null }> {
  const end = dateMinusDays(today, 1);
  const start = prop.backfill_from ? new Date(prop.backfill_from) : dateMinusDays(end, 90);
  return syncGa4Property(sb, prop, iso(start), iso(end));
}
