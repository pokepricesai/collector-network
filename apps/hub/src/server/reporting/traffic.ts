import 'server-only';

// Canonical reporting-traffic helper.
//
// Every dashboard / brief / intelligence rule that consumed GA4
// users / sessions / pageviews MUST route through here instead of
// querying `network_ga4_site_daily` directly. The helper:
//
//   * Calls the Postgres RPC `network_reporting_traffic(site_id,
//     start, end)` which excludes configured countries (default
//     ['Singapore']).
//   * Falls back to `network_ga4_site_daily` totals for dates the
//     country breakdown doesn't yet cover — flagged in the row with
//     `country_coverage='unfiltered_fallback'` so the UI can tell.
//
// RAW DATA IS NEVER MODIFIED. `network_ga4_site_daily` remains the
// source of truth for site-level totals. Country breakdown lives in
// `network_ga4_country_daily`. The reporting layer is a READ-side
// filter only.
//
// Config lookup is cached per-request for the duration of a single
// render; use `loadExcludedCountries(sb)` directly in diagnostics.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReportingTrafficDailyRow {
  date: string;                   // ISO 'YYYY-MM-DD'
  active_users: number;
  new_users: number;
  sessions: number;
  engaged_sessions: number;
  screen_page_views: number;
  raw_active_users: number;       // unfiltered day total (diagnostic)
  excluded_users: number;         // sum of active_users dropped
  country_coverage: 'filtered' | 'unfiltered_fallback';
}

export interface ReportingTrafficWindow {
  active_users: number;
  new_users: number;
  sessions: number;
  engaged_sessions: number;
  screen_page_views: number;
  raw_active_users: number;
  excluded_users: number;
  days_total: number;
  days_filtered: number;
  days_unfiltered_fallback: number;
  from: string;
  to: string;
}

export async function loadExcludedCountries(sb: SupabaseClient): Promise<string[]> {
  const { data } = await sb
    .from('network_settings')
    .select('value')
    .eq('key', 'reporting.excluded_countries')
    .is('site_id', null)
    .maybeSingle();
  const row = data as null | { value: unknown };
  const value = row?.value;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return ['Singapore'];
}

export async function getReportingTrafficDaily(
  sb: SupabaseClient,
  params: { site_id: string | null; from: string; to: string },
): Promise<ReportingTrafficDailyRow[]> {
  const { data, error } = await sb.rpc('network_reporting_traffic', {
    p_site_id: params.site_id,
    p_start: params.from,
    p_end: params.to,
  });
  if (error) throw new Error(`[reporting/traffic] rpc: ${error.message}`);
  const rows = (data ?? []) as Array<{
    date: string;
    active_users: number | string;
    new_users: number | string;
    sessions: number | string;
    engaged_sessions: number | string;
    screen_page_views: number | string;
    raw_active_users: number | string;
    excluded_users: number | string;
    country_coverage: 'filtered' | 'unfiltered_fallback';
  }>;
  return rows.map((r) => ({
    date: r.date,
    active_users:      Number(r.active_users),
    new_users:         Number(r.new_users),
    sessions:          Number(r.sessions),
    engaged_sessions:  Number(r.engaged_sessions),
    screen_page_views: Number(r.screen_page_views),
    raw_active_users:  Number(r.raw_active_users),
    excluded_users:    Number(r.excluded_users),
    country_coverage:  r.country_coverage,
  }));
}

export async function getReportingTrafficWindow(
  sb: SupabaseClient,
  params: { site_id: string | null; from: string; to: string },
): Promise<ReportingTrafficWindow> {
  const rows = await getReportingTrafficDaily(sb, params);
  let active_users = 0, new_users = 0, sessions = 0, engaged_sessions = 0, screen_page_views = 0;
  let raw_active_users = 0, excluded_users = 0;
  let filtered = 0, fallback = 0;
  for (const r of rows) {
    active_users      += r.active_users;
    new_users         += r.new_users;
    sessions          += r.sessions;
    engaged_sessions  += r.engaged_sessions;
    screen_page_views += r.screen_page_views;
    raw_active_users  += r.raw_active_users;
    excluded_users    += r.excluded_users;
    if (r.country_coverage === 'filtered') filtered += 1;
    else fallback += 1;
  }
  return {
    active_users, new_users, sessions, engaged_sessions, screen_page_views,
    raw_active_users, excluded_users,
    days_total: rows.length,
    days_filtered: filtered,
    days_unfiltered_fallback: fallback,
    from: params.from,
    to: params.to,
  };
}
