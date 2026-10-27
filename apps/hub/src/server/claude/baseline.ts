import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// CN-05 OS Phase C — baseline capture.
//
// Freeze a snapshot of the latest-complete GSC + GA4 reporting window
// for the site a task is attached to. Stored into
// network_tasks.metadata.baseline. Immutable under normal editing —
// the freeze Server Action refuses to overwrite an existing baseline
// without an explicit `force=1`.
//
// Why "frozen":
//   * Measurement at D7/D14/D28/D90 (future sprint) needs a stable
//     reference point. If baseline mutated every refresh, we'd
//     measure against moving goalposts.
//   * This file does NOT run measurement — it only captures the
//     before-picture. The measurement engine is explicitly out of
//     scope per the brief.
//
// What we capture:
//   * window_end     — latest date with complete data in BOTH gsc
//                      and ga4 site_daily tables (the min of their
//                      most-recent dates)
//   * window_start   — window_end minus 28 days
//   * data_source_freshness — the max latest-data date per source
//   * target_site_id, target_site_slug, target_url, target_query —
//     extracted from the task + intel evidence when present
//   * gsc_clicks_28d, gsc_impressions_28d, gsc_pages_with_clicks,
//     avg_position (impression-weighted), avg_ctr
//   * ga4_active_users_28d, ga4_sessions_28d (via
//     reporting-traffic, Singapore-excluded)

export interface BaselineSnapshot {
  frozen_at: string;
  frozen_version: 'cn05-baseline-v1';
  target_site_id: string | null;
  target_site_slug: string | null;
  target_url: string | null;
  target_query: string | null;
  window_start: string | null;
  window_end: string | null;
  data_source_freshness: { gsc: string | null; ga4: string | null };
  gsc_clicks_28d: number | null;
  gsc_impressions_28d: number | null;
  gsc_pages_with_impressions_28d: number | null;
  gsc_pages_with_clicks_28d: number | null;
  gsc_avg_position_28d: number | null;
  gsc_avg_ctr_28d: number | null;
  ga4_active_users_28d: number | null;
  ga4_sessions_28d: number | null;
  notes: string[];        // honest explanations when data was partial
  /** When true, no GSC data was available for the site/window. */
  no_gsc_data: boolean;
  no_ga4_data: boolean;
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso10: string, delta: number): string {
  const d = new Date(iso10 + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return iso(d);
}

async function latestDataDate(
  sb: SupabaseClient,
  table: 'network_gsc_site_daily' | 'network_ga4_site_daily',
  siteId: string | null,
): Promise<string | null> {
  let q = sb.from(table).select('date').order('date', { ascending: false }).limit(1);
  if (siteId) q = q.eq('site_id', siteId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return (data as { date: string }).date;
}

interface BuildBaselineInput {
  taskId: string;
  siteId: string | null;
  siteSlug: string | null;
  evidenceTargetUrl: string | null;
  evidenceTargetQuery: string | null;
}

export async function buildBaselineSnapshot(
  sb: SupabaseClient,
  input: BuildBaselineInput,
): Promise<BaselineSnapshot> {
  const notes: string[] = [];
  const [latestGsc, latestGa4] = await Promise.all([
    latestDataDate(sb, 'network_gsc_site_daily', input.siteId),
    latestDataDate(sb, 'network_ga4_site_daily', input.siteId),
  ]);
  if (!latestGsc) notes.push('No GSC rows available for this site; GSC metrics left null.');
  if (!latestGa4) notes.push('No GA4 rows available for this site; GA4 metrics left null.');

  // Use the min of the two end-dates so the window is consistent
  // across sources. Falls back cleanly when one source is missing.
  const windowEnd = latestGsc && latestGa4
    ? (latestGsc < latestGa4 ? latestGsc : latestGa4)
    : (latestGsc ?? latestGa4 ?? null);
  const windowStart = windowEnd ? addDays(windowEnd, -27) : null;

  let gsc_clicks = 0, gsc_imps = 0, pwi = 0, pwc = 0;
  let posWn = 0, posWd = 0;
  let gscRowCount = 0;
  if (windowStart && windowEnd && input.siteId) {
    const { data: gscRows, error: gscErr } = await sb
      .from('network_gsc_site_daily')
      .select('clicks, impressions, pages_with_impressions, pages_with_clicks, position_avg')
      .eq('site_id', input.siteId)
      .gte('date', windowStart)
      .lte('date', windowEnd);
    if (gscErr) {
      notes.push(`GSC read error: ${gscErr.message} — GSC metrics may be partial.`);
    } else {
      for (const r of (gscRows ?? []) as Array<{ clicks: number; impressions: number; pages_with_impressions: number; pages_with_clicks: number; position_avg: number | null }>) {
        gsc_clicks += r.clicks ?? 0;
        gsc_imps += r.impressions ?? 0;
        pwi += r.pages_with_impressions ?? 0;
        pwc += r.pages_with_clicks ?? 0;
        if (r.position_avg != null) {
          posWn += (r.impressions ?? 0) * r.position_avg;
          posWd += r.impressions ?? 0;
        }
        gscRowCount++;
      }
    }
    if (gscRowCount > 0 && gscRowCount < 20) {
      notes.push(`GSC window is partial — only ${gscRowCount} of ~28 days present. Comparison windows post-change should use the same shape.`);
    }
  } else if (!input.siteId) {
    notes.push('Task is network-scoped (no site_id). GSC + GA4 baselines are not captured for network-scoped tasks in v1.');
  }

  let ga4_users = 0, ga4_sessions = 0;
  if (windowStart && windowEnd && input.siteId) {
    // Prefer the Singapore-excluded reporting view when available.
    try {
      const { getReportingTrafficDaily } = await import('@/server/reporting/traffic');
      const gaRows = await getReportingTrafficDaily(sb, {
        site_id: input.siteId, from: windowStart, to: windowEnd,
      });
      for (const r of gaRows) {
        ga4_users += r.active_users ?? 0;
        ga4_sessions += r.sessions ?? 0;
      }
    } catch (e) {
      // Fall back to the raw network_ga4_site_daily table if the
      // country-breakdown view isn't available for this window.
      const { data: raw } = await sb
        .from('network_ga4_site_daily')
        .select('active_users, sessions')
        .eq('site_id', input.siteId)
        .gte('date', windowStart)
        .lte('date', windowEnd);
      for (const r of (raw ?? []) as Array<{ active_users: number; sessions: number }>) {
        ga4_users += r.active_users ?? 0;
        ga4_sessions += r.sessions ?? 0;
      }
      notes.push(`Reporting-traffic view unavailable (${(e as Error).message}); using raw network_ga4_site_daily.`);
    }
  }

  const no_gsc_data = gsc_imps === 0 && gsc_clicks === 0 && gscRowCount === 0;
  const no_ga4_data = ga4_users === 0 && ga4_sessions === 0;

  return {
    frozen_at: new Date().toISOString(),
    frozen_version: 'cn05-baseline-v1',
    target_site_id: input.siteId,
    target_site_slug: input.siteSlug,
    target_url: input.evidenceTargetUrl,
    target_query: input.evidenceTargetQuery,
    window_start: windowStart,
    window_end: windowEnd,
    data_source_freshness: { gsc: latestGsc, ga4: latestGa4 },
    gsc_clicks_28d: no_gsc_data ? null : gsc_clicks,
    gsc_impressions_28d: no_gsc_data ? null : gsc_imps,
    gsc_pages_with_impressions_28d: no_gsc_data ? null : pwi,
    gsc_pages_with_clicks_28d: no_gsc_data ? null : pwc,
    gsc_avg_position_28d: posWd > 0 ? posWn / posWd : null,
    gsc_avg_ctr_28d: gsc_imps > 0 ? gsc_clicks / gsc_imps : null,
    ga4_active_users_28d: no_ga4_data ? null : ga4_users,
    ga4_sessions_28d: no_ga4_data ? null : ga4_sessions,
    notes,
    no_gsc_data,
    no_ga4_data,
  };
}

/** Pick a target URL / query from task + intel evidence when the
 *  rule stored one. We look at common field names used across the
 *  intelligence rules (page, url, target_url, target_page, query,
 *  target_query). Returns strings or null. */
export function extractEvidenceTargets(
  taskEvidence: Record<string, unknown> | null | undefined,
  intelEvidence: Record<string, unknown> | null | undefined,
): { target_url: string | null; target_query: string | null } {
  const sources = [taskEvidence ?? {}, intelEvidence ?? {}];
  let target_url: string | null = null;
  let target_query: string | null = null;
  const urlKeys = ['target_url', 'url', 'page', 'target_page', 'affected_page'];
  const queryKeys = ['target_query', 'query'];
  for (const src of sources) {
    for (const k of urlKeys) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim().length > 0 && !target_url) {
        target_url = v.trim();
      }
    }
    for (const k of queryKeys) {
      const v = (src as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim().length > 0 && !target_query) {
        target_query = v.trim();
      }
    }
  }
  return { target_url, target_query };
}
