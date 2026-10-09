import 'server-only';

// Query helpers that build the data shape each chart on
// /admin/revenue needs. Deliberately keeps currencies SEPARATE —
// never sum GBP + USD into one value.

import type { SupabaseClient } from '@supabase/supabase-js';

export type ChartRange = '30d' | '90d' | '12m' | 'all';

function sinceDate(range: ChartRange): string | null {
  if (range === 'all') return null;
  const days = range === '30d' ? 30 : range === '90d' ? 90 : 365;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface EpnLedgerRow {
  site_id: string | null;
  source_id: string;
  occurred_on: string;
  amount_minor: number;
  currency: string;
  event_kind: string;
  ledger_status: string | null;
}

async function fetchEpnRows(sb: SupabaseClient, range: ChartRange): Promise<EpnLedgerRow[]> {
  const since = sinceDate(range);
  const PAGE = 1000;
  const out: EpnLedgerRow[] = [];
  // Only EPN sources for the affiliate charts.
  const { data: sources } = await sb
    .from('network_revenue_sources')
    .select('id, kind');
  const epnIds = ((sources ?? []) as Array<{ id: string; kind: string }>)
    .filter((s) => s.kind === 'ebay_epn')
    .map((s) => s.id);
  if (epnIds.length === 0) return out;

  for (let offset = 0; offset < 50_000; offset += PAGE) {
    let q = sb
      .from('network_revenue_events')
      .select('site_id, source_id, occurred_on, amount_minor, currency, event_kind, ledger_status')
      .in('source_id', epnIds)
      .order('occurred_on', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (since) q = q.gte('occurred_on', since);
    const { data, error } = await q;
    if (error) throw new Error(`[charts] epn: ${error.message}`);
    const page = (data ?? []) as EpnLedgerRow[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

export interface MonthlyBucket {
  bucket: string;              // 'YYYY-MM' or 'YYYY-WW'
  currency: string;
  confirmed_minor: number;
  pending_minor: number;
  reversed_minor: number;
}

export async function monthlyRevenueByCurrency(
  sb: SupabaseClient,
  range: ChartRange,
): Promise<MonthlyBucket[]> {
  const rows = await fetchEpnRows(sb, range);
  const key = (r: EpnLedgerRow) => `${monthKey(r.occurred_on)}:${r.currency}`;
  const map = new Map<string, MonthlyBucket>();
  for (const r of rows) {
    const k = key(r);
    const b = map.get(k) ?? {
      bucket: monthKey(r.occurred_on),
      currency: r.currency,
      confirmed_minor: 0,
      pending_minor: 0,
      reversed_minor: 0,
    };
    const status = r.ledger_status ?? 'unknown';
    if (status === 'confirmed') b.confirmed_minor += r.amount_minor;
    else if (status === 'pending') b.pending_minor += r.amount_minor;
    else if (status === 'reversed') b.reversed_minor += r.amount_minor;
    map.set(k, b);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.bucket === b.bucket ? a.currency.localeCompare(b.currency) : a.bucket.localeCompare(b.bucket),
  );
}

export interface SiteBreakdown {
  site_slug: string;
  site_name: string;
  currency: string;
  confirmed_minor: number;
  pending_minor: number;
  reversed_minor: number;
}

export async function revenueBySite(
  sb: SupabaseClient,
  range: ChartRange,
): Promise<SiteBreakdown[]> {
  const [rows, { data: sites }] = await Promise.all([
    fetchEpnRows(sb, range),
    sb.from('network_sites').select('id, slug, name'),
  ]);
  const siteById = new Map<string, { slug: string; name: string }>();
  for (const s of (sites ?? []) as Array<{ id: string; slug: string; name: string }>) {
    siteById.set(s.id, { slug: s.slug, name: s.name });
  }
  // Rows with site_id = NULL (historical EPN whose SubId1 coverage
  // on outbound links was partial/mixed) are grouped under a stable
  // "site-not-attributable" bucket. Not a warning — just an honest
  // label. Historical attribution cannot be reliably reconstructed;
  // future SubId1 tagging will fix this going forward only.
  const key = (r: EpnLedgerRow) => `${r.site_id ?? 'site-not-attributable'}:${r.currency}`;
  const map = new Map<string, SiteBreakdown>();
  for (const r of rows) {
    const k = key(r);
    const site = r.site_id ? siteById.get(r.site_id) : null;
    const b = map.get(k) ?? {
      site_slug: site?.slug ?? 'site-not-attributable',
      site_name: site?.name ?? 'Site not attributable',
      currency: r.currency,
      confirmed_minor: 0,
      pending_minor: 0,
      reversed_minor: 0,
    };
    const status = r.ledger_status ?? 'unknown';
    if (status === 'confirmed') b.confirmed_minor += r.amount_minor;
    else if (status === 'pending') b.pending_minor += r.amount_minor;
    else if (status === 'reversed') b.reversed_minor += r.amount_minor;
    map.set(k, b);
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.confirmed_minor + b.pending_minor) - (a.confirmed_minor + a.pending_minor),
  );
}

export interface SourceBreakdown {
  source_slug: string;
  source_name: string;
  currency: string;
  confirmed_minor: number;
  pending_minor: number;
  reversed_minor: number;
}

export async function revenueBySource(
  sb: SupabaseClient,
  range: ChartRange,
): Promise<SourceBreakdown[]> {
  const [rows, { data: sources }] = await Promise.all([
    fetchEpnRows(sb, range),
    sb.from('network_revenue_sources').select('id, slug, display_name'),
  ]);
  const sourceById = new Map<string, { slug: string; name: string }>();
  for (const s of (sources ?? []) as Array<{ id: string; slug: string; display_name: string }>) {
    sourceById.set(s.id, { slug: s.slug, name: s.display_name });
  }
  const key = (r: EpnLedgerRow) => `${r.source_id}:${r.currency}`;
  const map = new Map<string, SourceBreakdown>();
  for (const r of rows) {
    const k = key(r);
    const s = sourceById.get(r.source_id);
    const b = map.get(k) ?? {
      source_slug: s?.slug ?? '(unknown)',
      source_name: s?.name ?? '(unknown)',
      currency: r.currency,
      confirmed_minor: 0,
      pending_minor: 0,
      reversed_minor: 0,
    };
    const status = r.ledger_status ?? 'unknown';
    if (status === 'confirmed') b.confirmed_minor += r.amount_minor;
    else if (status === 'pending') b.pending_minor += r.amount_minor;
    else if (status === 'reversed') b.reversed_minor += r.amount_minor;
    map.set(k, b);
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.confirmed_minor + b.pending_minor) - (a.confirmed_minor + a.pending_minor),
  );
}

export interface RevenuePerKUsersPoint {
  bucket: string;                   // 'YYYY-MM'
  users: number;                    // network-wide active users
  confirmed_minor_by_currency: Record<string, number>;
  rpku_minor_by_currency: Record<string, number>;   // revenue per 1000 users
}

/**
 * Revenue-per-1000-users monthly series.
 *
 * Formula per month per currency:
 *   rpku_minor = (confirmed_revenue_minor / users) * 1000
 *
 * i.e. "how many minor-currency units of confirmed affiliate
 * commission did each 1,000 users produce this month". GBP and USD
 * are tracked independently — never summed.
 *
 * `users` is the sum of GA4 `active_users` across every row in
 * `network_ga4_site_daily` for the month. That is a sum of daily
 * actives, NOT monthly unique visitors (we don't have a monthly
 * dedupe table). A visitor who browsed on 3 different days counts
 * 3 times. The ratio trends correctly MoM because the overcount is
 * roughly proportional, but the absolute number should be read as
 * "per 1,000 session-days" if precision matters.
 *
 * If GA4 data is missing for a month, users = 0 and rpku is 0 for
 * that month — do not fabricate.
 */
export async function revenuePerThousandUsers(
  sb: SupabaseClient,
  range: ChartRange,
): Promise<RevenuePerKUsersPoint[]> {
  const since = sinceDate(range);
  const [rows, usersData] = await Promise.all([
    fetchEpnRows(sb, range),
    (async () => {
      // Reporting-traffic denominator: country-dimensioned, Singapore
      // excluded. Falls back automatically to raw site_daily for
      // dates with no country breakdown yet.
      const to   = new Date().toISOString().slice(0, 10);
      const from = since ?? '2024-01-01';
      const { getReportingTrafficDaily } = await import('@/server/reporting/traffic');
      const rows = await getReportingTrafficDaily(sb, { site_id: null, from, to });
      return rows.map((r) => ({ date: r.date, active_users: r.active_users }));
    })(),
  ]);

  const usersByMonth = new Map<string, number>();
  for (const u of usersData) {
    const m = monthKey(u.date);
    usersByMonth.set(m, (usersByMonth.get(m) ?? 0) + (u.active_users ?? 0));
  }

  const confirmedByMonth = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (r.ledger_status !== 'confirmed') continue;
    const m = monthKey(r.occurred_on);
    const bucket = confirmedByMonth.get(m) ?? {};
    bucket[r.currency] = (bucket[r.currency] ?? 0) + r.amount_minor;
    confirmedByMonth.set(m, bucket);
  }

  const months = new Set<string>([...usersByMonth.keys(), ...confirmedByMonth.keys()]);
  const out: RevenuePerKUsersPoint[] = [];
  for (const bucket of Array.from(months).sort()) {
    const users = usersByMonth.get(bucket) ?? 0;
    const confirmed = confirmedByMonth.get(bucket) ?? {};
    const rpku: Record<string, number> = {};
    for (const [ccy, amt] of Object.entries(confirmed)) {
      rpku[ccy] = users > 0 ? Math.round((amt / users) * 1000) : 0;
    }
    out.push({
      bucket,
      users,
      confirmed_minor_by_currency: confirmed,
      rpku_minor_by_currency: rpku,
    });
  }
  return out;
}
