import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Notice, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { loadExcludedCountries, getReportingTrafficWindow, getReportingTrafficDaily } from '@/server/reporting/traffic';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Traffic exclusion diagnostic page.
//
// Shows the global rule, per-site raw vs reporting totals for the
// trailing 28 days, and (where country data is present) the top 5
// countries by excluded-user volume. Also surfaces the data-coverage
// status so operators can tell "filtered" days from
// "unfiltered_fallback" days apart.

export default async function AnalyticsExclusionsPage() {
  const { admin, sb } = await requireAdmin('/admin/analytics/exclusions');
  const [sites, excluded] = await Promise.all([
    listNetworkSites(sb),
    loadExcludedCountries(sb),
  ]);

  const to   = new Date();
  const from = new Date(to.getTime() - 28 * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString().slice(0, 10);
  const toIso   = to.toISOString().slice(0, 10);

  const SITE_SLUGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'] as const;
  const siteRows = SITE_SLUGS
    .map((slug) => sites.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));

  const perSite = await Promise.all(
    siteRows.map(async (site) => {
      const win = await getReportingTrafficWindow(sb, { site_id: site.id, from: fromIso, to: toIso });
      const pct = win.raw_active_users > 0 ? (win.excluded_users / win.raw_active_users) * 100 : 0;
      return {
        site_slug: site.slug,
        site_name: site.name,
        raw_active_users:   win.raw_active_users,
        excluded_users:     win.excluded_users,
        reporting_users:    win.active_users,
        reporting_sessions: win.sessions,
        pct_excluded:       pct,
        days_total:         win.days_total,
        days_filtered:      win.days_filtered,
        days_fallback:      win.days_unfiltered_fallback,
      };
    }),
  );

  // Network-wide top-countries breakdown over the 28d window.
  const { data: countryBreakdownRows } = await sb
    .from('network_ga4_country_daily')
    .select('country, active_users')
    .gte('date', fromIso)
    .lte('date', toIso);
  interface CountryRow { country: string; active_users: number | string }
  const byCountry = new Map<string, number>();
  for (const r of ((countryBreakdownRows ?? []) as CountryRow[])) {
    byCountry.set(r.country, (byCountry.get(r.country) ?? 0) + Number(r.active_users ?? 0));
  }
  const topCountries = Array.from(byCountry.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([country, users]) => ({ country, users, is_excluded: excluded.includes(country) }));
  const totalCountryUsers = Array.from(byCountry.values()).reduce((a, b) => a + b, 0);

  // Daily country-coverage flag for the network — tells operators
  // how many of the 28 days have country data vs fallback.
  const network = await getReportingTrafficDaily(sb, { site_id: null, from: fromIso, to: toIso });
  const coverageSummary = {
    total: network.length,
    filtered: network.filter((r) => r.country_coverage === 'filtered').length,
    fallback: network.filter((r) => r.country_coverage === 'unfiltered_fallback').length,
  };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/analytics/exclusions">
      <SectionHeader
        eyebrow="Analytics · Reporting rule"
        title="Traffic exclusion diagnostics"
        description={<>Raw GA4 data is preserved as received. All downstream dashboards use <em>reporting traffic</em> = raw <strong>minus</strong> the countries listed below. GSC search data is NOT affected by this rule.</>}
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/jobs">Run GA4 country jobs</Link>}
      />

      <Panel title="Current reporting rule" eyebrow="network_settings · key = reporting.excluded_countries">
        <Notice tone="info">
          <strong>Excluded from reporting denominators:</strong>{' '}
          {excluded.length === 0 ? '(none)' : excluded.map((c) => <code key={c} style={{ marginRight: 6 }}>{c}</code>)}
          <br />
          Raw rows for excluded countries remain in <code>network_ga4_country_daily</code> for audit.
        </Notice>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: '10px 0 0' }}>
          Window shown below: <strong>{fromIso}</strong> → <strong>{toIso}</strong> (trailing 28 days).
        </p>
      </Panel>

      <Panel title="28-day raw vs reporting — per site" eyebrow="active_users">
        <Table
          columns={[
            { key: 'site', header: 'Site', render: (r: PerSiteRow) => <strong>{r.site_slug}</strong> },
            { key: 'raw',  header: 'Raw active users', className: 'num', render: (r: PerSiteRow) => fmt(r.raw_active_users) },
            { key: 'ex',   header: 'Excluded users',   className: 'num', render: (r: PerSiteRow) => <span style={{ color: r.excluded_users > 0 ? 'var(--warning, #e67e22)' : 'inherit' }}>{fmt(r.excluded_users)}</span> },
            { key: 'rep',  header: 'Reporting users',  className: 'num', render: (r: PerSiteRow) => <strong>{fmt(r.reporting_users)}</strong> },
            { key: 'pct',  header: '% excluded',       className: 'num', render: (r: PerSiteRow) => `${r.pct_excluded.toFixed(1)}%` },
            { key: 'ses',  header: 'Reporting sessions', className: 'num', render: (r: PerSiteRow) => fmt(r.reporting_sessions) },
            { key: 'cov',  header: 'Country coverage', render: (r: PerSiteRow) =>
              r.days_filtered === 0
                ? <StatusBadge state="warning" label={`${r.days_fallback}d fallback`} />
                : <StatusBadge state={r.days_fallback === 0 ? 'success' : 'warning'} label={`${r.days_filtered}d filtered · ${r.days_fallback}d fallback`} /> },
          ]}
          rows={perSite.map((r, i) => ({ id: `${i}`, ...r }))}
          empty=""
        />
        {coverageSummary.filtered === 0 && (
          <Notice tone="warning">
            <strong>No country-dimensioned data yet.</strong>{' '}
            All 28 days are using the <code>unfiltered_fallback</code> path (raw <code>network_ga4_site_daily</code> totals shown as reporting). Run{' '}
            <code>ga4.country.backfill_90d</code> at <Link href="/admin/jobs">/admin/jobs</Link> to populate the breakdown; the filter will activate automatically as rows land.
          </Notice>
        )}
      </Panel>

      <Panel title="Country breakdown (last 28d, network-wide)" eyebrow="active_users">
        {topCountries.length === 0 ? (
          <Notice tone="info">
            No rows in <code>network_ga4_country_daily</code> yet. The nightly <code>ga4.country.sync</code> job + the 90-day backfill will populate this.
          </Notice>
        ) : (
          <Table
            columns={[
              { key: 'c', header: 'Country', render: (r: CountryShowRow) =>
                r.is_excluded
                  ? <><StatusBadge state="warning" label="excluded" /> <strong style={{ marginLeft: 6 }}>{r.country}</strong></>
                  : <strong>{r.country}</strong> },
              { key: 'u', header: 'Active users', className: 'num', render: (r: CountryShowRow) => fmt(r.users) },
              { key: 'p', header: '% of network', className: 'num', render: (r: CountryShowRow) =>
                totalCountryUsers > 0 ? `${((r.users / totalCountryUsers) * 100).toFixed(1)}%` : '—' },
            ]}
            rows={topCountries.map((r, i) => ({ id: `${i}`, ...r }))}
            empty=""
          />
        )}
      </Panel>

      <Panel title="Where this filter applies" eyebrow="Downstream readers">
        <ul style={{ fontSize: 13, lineHeight: 1.7, margin: 0, paddingLeft: 20 }}>
          <li><code>fetchNetworkTotal()</code>, <code>fetchSiteLevel()</code> — dashboard + SEO header</li>
          <li><code>fetchDayTotals()</code> — /admin/brief yesterday metrics</li>
          <li><code>revenuePerThousandUsers()</code> — /admin/revenue RPKU chart</li>
          <li>All intelligence rules that consume GA4 active_users (currently none; growth + traffic_without_revenue use GSC clicks and are intentionally unfiltered)</li>
        </ul>
        <p className="col-dim" style={{ fontSize: 12, marginTop: 10 }}>
          GSC search data (clicks, impressions, position) is NOT filtered. Revenue totals are NOT filtered — only the user/session denominators used in revenue-efficiency metrics change.
        </p>
      </Panel>
    </AdminShell>
  );
}

interface PerSiteRow {
  id: string;
  site_slug: string;
  site_name: string;
  raw_active_users: number;
  excluded_users: number;
  reporting_users: number;
  reporting_sessions: number;
  pct_excluded: number;
  days_total: number;
  days_filtered: number;
  days_fallback: number;
}
interface CountryShowRow { id: string; country: string; users: number; is_excluded: boolean }

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString();
}
