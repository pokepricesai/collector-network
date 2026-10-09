import 'server-only';

// Dashboard aggregation layer. Reads normalised network_* tables
// via SQL functions. The functions are SECURITY INVOKER so admin
// RLS applies naturally.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getReportingTrafficWindow } from '@/server/reporting/traffic';

export interface DashboardTotals {
  activeUsers: number;
  sessions: number;
  googleClicks: number;
  googleImpressions: number;
  pagesWithImpressions: number;
  pagesWithClicks: number;
  avgPosition: number | null;
}

export interface SiteLevel extends DashboardTotals {
  siteId: string;
  slug: string;
}

export interface RangeWindow {
  start: Date;
  end: Date;
}

export function windowDaysAgo(today: Date, days: number): RangeWindow {
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - 1); // yesterday
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (days - 1));
  return { start, end };
}

export function priorWindow(w: RangeWindow): RangeWindow {
  const length = Math.round((w.end.getTime() - w.start.getTime()) / 86400000) + 1;
  const end = new Date(w.start);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - (length - 1));
  return { start, end };
}

export function iso(d: Date): string { return d.toISOString().slice(0, 10); }

const EMPTY: DashboardTotals = {
  activeUsers: 0, sessions: 0,
  googleClicks: 0, googleImpressions: 0,
  pagesWithImpressions: 0, pagesWithClicks: 0, avgPosition: null,
};

export async function fetchNetworkTotal(sb: SupabaseClient, w: RangeWindow): Promise<DashboardTotals> {
  const [rpcResult, reporting] = await Promise.all([
    sb.rpc('network_dashboard_total', {
      p_start: iso(w.start), p_end: iso(w.end),
    }),
    // Reporting-traffic (Singapore-excluded by default) overrides the
    // active_users/sessions coming from the raw RPC. GSC fields stay
    // authoritative because GSC data is NOT filtered.
    getReportingTrafficWindow(sb, { site_id: null, from: iso(w.start), to: iso(w.end) }),
  ]);
  const { data, error } = rpcResult;
  if (error) throw new Error(`[dashboard] total: ${error.message}`);
  const row = (data as unknown as Array<{
    active_users: number; sessions: number;
    google_clicks: number; google_impressions: number;
    pages_with_impressions: number; pages_with_clicks: number;
    avg_position: number | null;
  }> | null)?.[0];
  if (!row) return { ...EMPTY, activeUsers: reporting.active_users, sessions: reporting.sessions };
  return {
    activeUsers: reporting.active_users,
    sessions:    reporting.sessions,
    googleClicks: Number(row.google_clicks ?? 0),
    googleImpressions: Number(row.google_impressions ?? 0),
    pagesWithImpressions: Number(row.pages_with_impressions ?? 0),
    pagesWithClicks: Number(row.pages_with_clicks ?? 0),
    avgPosition: row.avg_position == null ? null : Number(row.avg_position),
  };
}

export async function fetchSiteLevel(sb: SupabaseClient, w: RangeWindow): Promise<SiteLevel[]> {
  const { data, error } = await sb.rpc('network_dashboard_sitelevel', {
    p_start: iso(w.start), p_end: iso(w.end),
  });
  if (error) throw new Error(`[dashboard] sitelevel: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    site_id: string; slug: string;
    active_users: number; sessions: number;
    google_clicks: number; google_impressions: number;
    pages_with_impressions: number; pages_with_clicks: number;
    avg_position: number | null;
  }>;
  // Overlay reporting-traffic per site. One extra RPC per site keeps
  // the code simple; the per-site aggregation is cheap because the
  // country table is small.
  const perSite = await Promise.all(
    rows.map(async (r) => {
      const rep = await getReportingTrafficWindow(sb, { site_id: r.site_id, from: iso(w.start), to: iso(w.end) });
      return {
        siteId: r.site_id, slug: r.slug,
        activeUsers: rep.active_users,
        sessions:    rep.sessions,
        googleClicks: Number(r.google_clicks ?? 0),
        googleImpressions: Number(r.google_impressions ?? 0),
        pagesWithImpressions: Number(r.pages_with_impressions ?? 0),
        pagesWithClicks: Number(r.pages_with_clicks ?? 0),
        avgPosition: r.avg_position == null ? null : Number(r.avg_position),
      } as SiteLevel;
    }),
  );
  return perSite;
}

export interface FreshnessRow {
  siteId: string;
  slug: string;
  kind: 'gsc' | 'ga4';
  propertyId: string;
  lastDataDate: string | null;
  lastSyncAt: string | null;
  status: string;
}

export async function fetchFreshness(sb: SupabaseClient): Promise<FreshnessRow[]> {
  const { data, error } = await sb
    .from('network_google_properties')
    .select('site_id,kind,property_id,last_data_date,last_sync_at,status,network_sites!inner(slug)')
    .order('kind');
  if (error) throw new Error(`[dashboard] freshness: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    site_id: string; kind: 'gsc' | 'ga4'; property_id: string;
    last_data_date: string | null; last_sync_at: string | null; status: string;
    network_sites: { slug: string };
  }>;
  return rows.map((r) => ({
    siteId: r.site_id, slug: r.network_sites.slug, kind: r.kind,
    propertyId: r.property_id, lastDataDate: r.last_data_date,
    lastSyncAt: r.last_sync_at, status: r.status,
  }));
}
