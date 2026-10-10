import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  MetricCard, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';
import {
  fetchFreshness, fetchNetworkTotal, fetchSiteLevel,
  priorWindow, windowDaysAgo,
} from '@/server/analytics/dashboard';
import { formatDelta, formatInt, formatPct, formatRelative } from '@/lib/format';
import Link from 'next/link';
import { fetchTaskSummary, listHighPriorityTasks } from '@/server/tasks/queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Executive dashboard. Phase 1: real GSC + GA4 numbers for 28d (and
// a 7d pulse) with prior-period comparison. Users = GA4 activeUsers
// (single canonical definition). No fabricated metrics; sources
// without a feed stay 'Not connected'.

export default async function OverviewPage() {
  const { admin, sb } = await requireAdmin('/admin');
  const sites = await listNetworkSites(sb);
  const today = new Date();

  const window28 = windowDaysAgo(today, 28);
  const prior28 = priorWindow(window28);
  const window7 = windowDaysAgo(today, 7);

  const [curr28, prior28Totals, curr7, siteLevel, freshness, taskSummary, topTasks] = await Promise.all([
    fetchNetworkTotal(sb, window28),
    fetchNetworkTotal(sb, prior28),
    fetchNetworkTotal(sb, window7),
    fetchSiteLevel(sb, window28),
    fetchFreshness(sb),
    fetchTaskSummary(sb),
    listHighPriorityTasks(sb, 5),
  ]);

  // Phase-2 counts for the dashboard quick-glance panel.
  const [
    { count: openOppsCount },
    { count: openIlCount },
    { count: openPageOppsCount },
    { count: openSitemapIssues },
    { count: openIndexingIssues },
    { count: recentSeoChanges },
  ] = await Promise.all([
    sb.from('network_opportunities').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('network_internal_link_opportunities').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('network_page_opportunities').select('*', { count: 'exact', head: true }).eq('status', 'open'),
    sb.from('network_sitemap_issues').select('*', { count: 'exact', head: true }).is('resolved_at', null),
    sb.from('network_url_inspections').select('*', { count: 'exact', head: true }).ilike('coverage_state', '%not indexed%'),
    sb.from('network_seo_changes').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()),
  ]);

  // Build a lightweight "today's priorities" preview (top 5 brief actions)
  // without re-running the full brief engine; we read the latest persisted
  // brief if present and fall back to a live rebuild.
  const { data: cachedBriefRow } = await sb
    .from('network_daily_briefs')
    .select('for_date, payload')
    .order('for_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  type BriefAction = { id: string; priority: 'critical' | 'high' | 'normal' | 'low'; title: string; description: string; link: string; source: string };
  const cachedActions = ((cachedBriefRow as { payload?: { actions?: BriefAction[] } } | null)?.payload?.actions ?? []).slice(0, 5);

  const gscMaxDate = freshness
    .filter((f) => f.kind === 'gsc' && f.lastDataDate)
    .map((f) => f.lastDataDate!)
    .sort().slice(-1)[0];
  const ga4MaxDate = freshness
    .filter((f) => f.kind === 'ga4' && f.lastDataDate)
    .map((f) => f.lastDataDate!)
    .sort().slice(-1)[0];
  const anyConnected = freshness.some((f) => !!f.lastDataDate);

  const bySite = new Map(siteLevel.map((s) => [s.slug, s]));
  const connectedSites = new Set(
    freshness.filter((f) => f.lastDataDate).map((f) => `${f.slug}|${f.kind}`),
  );

  interface SiteRow {
    id: string;
    name: string;
    slug: string;
    status: 'active' | 'parked' | 'planned' | 'archived';
    activeUsers: number;
    sessions: number;
    googleClicks: number;
    googleImpressions: number;
    avgPosition: number | null;
    gaConnected: boolean;
    gscConnected: boolean;
  }

  const rows: SiteRow[] = sites.map((s) => {
    const siteMetrics = bySite.get(s.slug);
    return {
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      activeUsers: siteMetrics?.activeUsers ?? 0,
      sessions: siteMetrics?.sessions ?? 0,
      googleClicks: siteMetrics?.googleClicks ?? 0,
      googleImpressions: siteMetrics?.googleImpressions ?? 0,
      avgPosition: siteMetrics?.avgPosition ?? null,
      gaConnected: connectedSites.has(`${s.slug}|ga4`),
      gscConnected: connectedSites.has(`${s.slug}|gsc`),
    };
  });

  const metrics = [
    { label: 'Users (28d)',               value: curr28.activeUsers,          prior: prior28Totals.activeUsers,          connected: !!ga4MaxDate },
    { label: 'Sessions (28d)',            value: curr28.sessions,             prior: prior28Totals.sessions,             connected: !!ga4MaxDate },
    { label: 'Google clicks (28d)',       value: curr28.googleClicks,         prior: prior28Totals.googleClicks,         connected: !!gscMaxDate },
    { label: 'Google impressions (28d)',  value: curr28.googleImpressions,    prior: prior28Totals.googleImpressions,    connected: !!gscMaxDate },
    { label: 'Pages with impressions',    value: curr28.pagesWithImpressions, prior: prior28Totals.pagesWithImpressions, connected: !!gscMaxDate },
    { label: 'Pages with clicks',         value: curr28.pagesWithClicks,      prior: prior28Totals.pagesWithClicks,      connected: !!gscMaxDate },
  ];

  const notYetConnected = [
    { label: 'Affiliate revenue', helper: 'Awaits eBay Partner Network wiring' },
    { label: 'Operating cost',    helper: 'Awaits cost ledger' },
    { label: 'Indexed pages',     helper: 'Awaits GSC Index Coverage feed' },
    { label: 'X followers',       helper: 'Awaits X integration' },
  ];

  const freshRows = freshness.map((r, i) => ({ ...r, id: `${r.siteId}-${r.kind}-${i}` }));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin">
      <SectionHeader
        eyebrow="Overview"
        title="What should we work on today?"
        description={
          anyConnected
            ? `Executive view across the five Collector Network platforms. GSC data through ${gscMaxDate ?? '—'}; GA4 through ${ga4MaxDate ?? '—'}. Traffic metrics exclude Singapore bot/spam traffic.`
            : 'Executive view. Google Search Console + Analytics are configured but have not yet completed their first sync — run /api/sync/backfill?kind=gsc and ?kind=ga4 to populate.'
        }
      />

      <div className="metric-grid">
        {metrics.map((m) => (
          <MetricCard
            key={m.label}
            label={m.label}
            value={m.connected ? formatInt(m.value) : null}
            state={m.connected ? 'ok' : 'not-connected'}
            helper={
              m.connected
                ? (() => {
                    const d = formatDelta(m.value, m.prior);
                    return d.sign === 'flat'
                      ? `vs prior 28d: ${formatInt(m.prior)}`
                      : `${d.label} vs prior 28d (${formatInt(m.prior)})`;
                  })()
                : undefined
            }
          />
        ))}
        {notYetConnected.map((m) => (
          <MetricCard key={m.label} label={m.label} state="not-connected" helper={m.helper} />
        ))}
      </div>

      <Panel
        title="Today's priorities"
        eyebrow={cachedBriefRow ? `Brief for ${(cachedBriefRow as { for_date: string }).for_date}` : 'Daily brief'}
        actions={<Link className="status-badge status-opportunity" href="/admin/brief">Open brief →</Link>}
      >
        {cachedActions.length === 0 ? (
          <div className="admin-empty admin-empty--muted">
            <div className="admin-empty-title">No actions queued.</div>
            <div className="admin-empty-desc">Trigger <code>/api/sync/brief</code> after a GSC sync to populate.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {cachedActions.map((a) => (
              <div key={a.id} style={{ padding: '8px 12px', border: '1px solid #E6E6E6', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
                <StatusBadge state={a.priority} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Link href={a.link} style={{ fontWeight: 600, fontSize: 13 }}>{a.title}</Link>
                  <span className="col-dim" style={{ fontSize: 11 }}>{a.description}</span>
                </div>
                <Link className="status-badge status-not_connected" href={a.link}>Open →</Link>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Open tasks" actions={<Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm">View all</Link>}>
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Total open" value={formatInt(taskSummary.total_open)} helper={`${formatInt(taskSummary.network_scope)} network · ${formatInt(taskSummary.total_open - taskSummary.network_scope)} site-scoped`} />
          <MetricCard label="Fixes"       value={formatInt(taskSummary.fixes)} />
          <MetricCard label="Improvements" value={formatInt(taskSummary.improvements)} />
          <MetricCard label="High priority" value={formatInt(taskSummary.high_priority)} helper="critical + high" />
          <MetricCard label="Manual"       value={formatInt(taskSummary.manual)} helper="jotted-down" />
          <MetricCard label="Intelligence" value={formatInt(taskSummary.intelligence)} helper="from inbox" />
        </div>
        {topTasks.length > 0 && (
          <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {topTasks.map((t) => (
              <li key={t.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0', borderTop: '1px solid var(--admin-border)' }}>
                <StatusBadge state={t.priority === 'critical' ? 'critical' : 'high'} />
                <Link href="/admin/tasks" style={{ flex: 1, textDecoration: 'none', color: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</Link>
                <span className="col-dim" style={{ fontSize: 11 }}>{t.task_source}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="SEO workload" eyebrow="Open items">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="SEO opportunities" value={formatInt(openOppsCount ?? 0)} helper="deterministic, open" />
          <MetricCard label="Internal-link opps" value={formatInt(openIlCount ?? 0)} />
          <MetricCard label="Page opportunities" value={formatInt(openPageOppsCount ?? 0)} />
          <MetricCard label="Sitemap issues"    value={formatInt(openSitemapIssues ?? 0)} helper="unresolved" />
          <MetricCard label="Indexing issues"   value={formatInt(openIndexingIssues ?? 0)} helper="inspected as not-indexed" />
          <MetricCard label="SEO changes (7d)"  value={formatInt(recentSeoChanges ?? 0)} />
        </div>
      </Panel>

      <Panel title="7-day pulse" eyebrow="Trailing 7 days">
        <div className="metric-grid metric-grid--compact">
          <MetricCard label="Users"              value={ga4MaxDate ? formatInt(curr7.activeUsers)       : null} state={ga4MaxDate ? 'ok' : 'not-connected'} />
          <MetricCard label="Sessions"           value={ga4MaxDate ? formatInt(curr7.sessions)          : null} state={ga4MaxDate ? 'ok' : 'not-connected'} />
          <MetricCard label="Google clicks"      value={gscMaxDate ? formatInt(curr7.googleClicks)      : null} state={gscMaxDate ? 'ok' : 'not-connected'} />
          <MetricCard label="Google impressions" value={gscMaxDate ? formatInt(curr7.googleImpressions) : null} state={gscMaxDate ? 'ok' : 'not-connected'} />
        </div>
      </Panel>

      <Panel title="Site portfolio" eyebrow="Sites · 28d">
        <Table<SiteRow>
          columns={[
            { key: 'site',   header: 'Site',          render: (s) => <Link href={`/admin/sites/${s.slug}`}>{s.name}</Link> },
            { key: 'users',  header: 'Users',         className: 'col-num', render: (s) => s.gaConnected ? formatInt(s.activeUsers) : <span className="col-dim">Not connected</span> },
            { key: 'clicks', header: 'Google clicks', className: 'col-num', render: (s) => s.gscConnected ? formatInt(s.googleClicks) : <span className="col-dim">Not connected</span> },
            { key: 'impr',   header: 'Impressions',   className: 'col-num', render: (s) => s.gscConnected ? formatInt(s.googleImpressions) : <span className="col-dim">Not connected</span> },
            { key: 'ctr',    header: 'CTR',           className: 'col-num', render: (s) => s.gscConnected && s.googleImpressions > 0 ? formatPct(s.googleClicks / s.googleImpressions) : <span className="col-dim">—</span> },
            { key: 'pos',    header: 'Avg pos',       className: 'col-num', render: (s) => s.gscConnected && s.avgPosition != null ? s.avgPosition.toFixed(1) : <span className="col-dim">—</span> },
            { key: 'health', header: 'Health',        render: (s) => <StatusBadge state={s.status} /> },
          ]}
          rows={rows}
        />
      </Panel>

      <Panel title="Data freshness" eyebrow="Sources">
        <Table
          columns={[
            { key: 'site',   header: 'Site',          render: (r: typeof freshRows[number]) => r.slug },
            { key: 'source', header: 'Source',        render: (r) => r.kind.toUpperCase() },
            { key: 'prop',   header: 'Property',      render: (r) => <code>{r.propertyId}</code> },
            { key: 'data',   header: 'Data through',  render: (r) => r.lastDataDate ?? <span className="col-dim">—</span> },
            { key: 'synced', header: 'Last synced',   render: (r) => formatRelative(r.lastSyncAt) },
            { key: 'status', header: 'Status',        render: (r) => <StatusBadge state={r.status as 'active'} /> },
          ]}
          rows={freshRows}
        />
      </Panel>
    </AdminShell>
  );
}
