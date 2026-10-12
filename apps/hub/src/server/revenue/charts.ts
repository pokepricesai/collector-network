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
  users: number;                    // Singapore-excluded reporting active-user-days
  confirmed_minor_by_currency: Record<string, number>;
  pending_minor_by_currency:   Record<string, number>;
  attributed_minor_by_currency: Record<string, number>; // confirmed + pending
  // RPKU variants — same denominator, different numerators.
  rpku_minor_by_currency:           Record<string, number>;   // confirmed per 1k
  rpku_attributed_minor_by_currency: Record<string, number>;  // attributed per 1k
  // Maturity flag — true when this month is still accumulating pending
  // approvals (current month, or any month whose pending share is >=
  // 20% of attributed OR less than ~45 days from today). The chart
  // uses this to style the attributed line as provisional.
  is_immature: boolean;
}

/**
 * Revenue-per-1000-active-user-days monthly series.
 *
 * Formulae per month per currency:
 *   rpku            = (confirmed_minor / users) * 1000     "realised"
 *   rpku_attributed = (attributed_minor / users) * 1000    "incl. pending"
 *   attributed      = confirmed + pending
 *
 * i.e. "how many minor-currency units of confirmed (or
 * confirmed+pending) affiliate commission did each 1,000 reporting
 * user-days produce this month". GBP and USD tracked independently.
 *
 * `users` is Singapore-excluded reporting active-user-days from the
 * network_reporting_traffic layer (NOT raw GA4). It is a sum of
 * daily actives, not monthly unique visitors; read as "per 1,000
 * session-days" if precision matters.
 *
 * The attributed series fixes the visual regression where recent
 * months would collapse toward zero: pending commission that
 * eventually approves is included in attributed, so the operator
 * can see provisional-but-honest efficiency alongside the realised
 * confirmed line.
 *
 * If GA4 data is missing for a month, users = 0 and both rpkus are
 * 0 for that month — do not fabricate.
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
  const pendingByMonth   = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const m = monthKey(r.occurred_on);
    if (r.ledger_status === 'confirmed') {
      const bucket = confirmedByMonth.get(m) ?? {};
      bucket[r.currency] = (bucket[r.currency] ?? 0) + r.amount_minor;
      confirmedByMonth.set(m, bucket);
    } else if (r.ledger_status === 'pending') {
      const bucket = pendingByMonth.get(m) ?? {};
      bucket[r.currency] = (bucket[r.currency] ?? 0) + r.amount_minor;
      pendingByMonth.set(m, bucket);
    }
  }

  const currentMonthKey = monthKey(new Date().toISOString().slice(0, 10));
  const months = new Set<string>([
    ...usersByMonth.keys(), ...confirmedByMonth.keys(), ...pendingByMonth.keys(),
  ]);
  const out: RevenuePerKUsersPoint[] = [];
  for (const bucket of Array.from(months).sort()) {
    const users = usersByMonth.get(bucket) ?? 0;
    const confirmed = confirmedByMonth.get(bucket) ?? {};
    const pending   = pendingByMonth.get(bucket) ?? {};
    const attributed: Record<string, number> = {};
    const rpku: Record<string, number> = {};
    const rpkuAttributed: Record<string, number> = {};
    const allCcys = new Set([...Object.keys(confirmed), ...Object.keys(pending)]);
    for (const ccy of allCcys) {
      const c = confirmed[ccy] ?? 0;
      const p = pending[ccy] ?? 0;
      const a = c + p;
      attributed[ccy] = a;
      rpku[ccy]           = users > 0 ? Math.round((c / users) * 1000) : 0;
      rpkuAttributed[ccy] = users > 0 ? Math.round((a / users) * 1000) : 0;
    }
    // Maturity rule: current month is always immature, prior month is
    // immature if its pending share is >= 20% of attributed in GBP
    // (the dominant currency). This mirrors how operators think about
    // approval lag: ~30-60 days of pending is normal.
    const gbpAttrib = attributed['GBP'] ?? 0;
    const gbpPending = pending['GBP'] ?? 0;
    const pendingShare = gbpAttrib > 0 ? gbpPending / gbpAttrib : 0;
    const is_immature = bucket === currentMonthKey || pendingShare >= 0.20;
    out.push({
      bucket,
      users,
      confirmed_minor_by_currency:  confirmed,
      pending_minor_by_currency:    pending,
      attributed_minor_by_currency: attributed,
      rpku_minor_by_currency:            rpku,
      rpku_attributed_minor_by_currency: rpkuAttributed,
      is_immature,
    });
  }
  return out;
}
