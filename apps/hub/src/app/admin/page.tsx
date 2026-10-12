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
        eyebrow="Collector Network OS"
        title="Network Overview"
        description={
          anyConnected
            ? <>Executive view across the five Collector Network platforms. GSC data through <strong>{gscMaxDate ?? '—'}</strong>; GA4 through <strong>{ga4MaxDate ?? '—'}</strong>. Traffic metrics exclude Singapore bot/spam traffic. Day-by-day priorities live on <Link href="/admin/brief" style={{ fontWeight: 600 }}>Morning Brief</Link>.</>
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
        {/* Not-yet-connected placeholder metrics (Affiliate revenue,
            Operating cost, Indexed pages, X followers) removed from
            primary KPI strip during the polish pass. Revenue is live
            on /admin/revenue; the rest will reappear when their
            feeds are wired. */}
      </div>

      {taskSummary.inbox_open === 0 ? (
        <Panel title="Open tasks" actions={<Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm">View all</Link>}>
          <div style={{ fontSize: 13, color: 'var(--admin-text-muted)' }}>
            Operator inbox is clear.{taskSummary.system > 0 && <> {formatInt(taskSummary.system)} system-generated items available in <Link href="/admin/tasks?source=system">System</Link>.</>}
          </div>
        </Panel>
      ) : (
        <Panel title="Open tasks" actions={<Link href="/admin/tasks" className="ui-btn ui-btn--secondary ui-btn--sm">View all</Link>}>
          <div className="metric-grid metric-grid--compact">
            <MetricCard label="Operator inbox" value={formatInt(taskSummary.inbox_open)} helper="manual + intelligence" />
            <MetricCard label="Fixes"          value={formatInt(taskSummary.inbox_fixes)} />
            <MetricCard label="Improvements"   value={formatInt(taskSummary.inbox_improvements)} />
            <MetricCard label="High priority"  value={formatInt(taskSummary.inbox_high_priority)} helper="critical + high" />
          </div>
          {taskSummary.system > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--admin-text-muted)', marginTop: 8 }}>
              Plus {formatInt(taskSummary.system)} system-generated items hidden by default — see <Link href="/admin/tasks?source=system" style={{ textDecoration: 'underline' }}>System</Link> or <Link href="/admin/tasks?source=all" style={{ textDecoration: 'underline' }}>All sources</Link>.
            </div>
          )}
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
      )}

      <Panel title="SEO workload" eyebrow="Opportunities + current issues">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Opportunities</div>
            <div className="metric-grid metric-grid--compact">
              <MetricCard label="SEO opportunities"  value={formatInt(openOppsCount ?? 0)} helper="deterministic, open" />
              <MetricCard label="Internal-link opps" value={formatInt(openIlCount ?? 0)} />
              <MetricCard label="Page opportunities" value={formatInt(openPageOppsCount ?? 0)} />
            </div>
          </div>
          <div>
            <div className="admin-eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Current issues &amp; activity</div>
            <div className="metric-grid metric-grid--compact">
              <MetricCard label="Sitemap issues (all)" value={formatInt(openSitemapIssues ?? 0)} helper="URL-level inspection; most are historical info/warning" />
              <MetricCard label="Indexing issues"      value={formatInt(openIndexingIssues ?? 0)} helper="inspected as not-indexed" />
              <MetricCard label="SEO changes (7d)"     value={formatInt(recentSeoChanges ?? 0)} />
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 8 }}>
          Site-level sitemap errors (as detected by Intelligence) appear in <Link href="/admin/intelligence?category=indexing">Intelligence</Link>. The counts here are the full historical open rows from <code>network_sitemap_issues</code>.
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
            { key: 'status', header: 'Lifecycle',     render: (s) => <StatusBadge state={s.status} /> },
          ]}
          rows={rows}
        />
      </Panel>

      <Panel title="Data freshness" eyebrow="Sources backing this view" actions={<Link href="/admin/health" className="ui-btn ui-btn--secondary ui-btn--sm">Full health view</Link>}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {(() => {
            // Compress per-site rows into source-level freshness so
            // operators see Fresh/Aging/Stale at a glance.
            const bySource = new Map<string, { kind: string; latest: string | null }>();
            for (const f of freshness) {
              const key = f.kind;
              const prev = bySource.get(key);
              if (!prev || (f.lastDataDate && (!prev.latest || f.lastDataDate > prev.latest))) {
                bySource.set(key, { kind: f.kind, latest: f.lastDataDate ?? prev?.latest ?? null });
              }
            }
            return Array.from(bySource.values()).map((s) => {
              const ageHours = s.latest ? (Date.now() - new Date(s.latest).getTime()) / (1000 * 60 * 60) : null;
              const state = ageHours == null ? 'never' : ageHours <= 48 ? 'fresh' : ageHours <= 120 ? 'aging' : 'stale';
              const label = s.latest ? `through ${s.latest}` : 'never';
              const bg = state === 'fresh' ? 'var(--success-soft, #e6f7ec)' : state === 'aging' ? 'var(--warning-soft, #fff3e0)' : 'var(--admin-surface)';
              const fg = state === 'fresh' ? 'var(--success)' : state === 'aging' ? 'var(--warning)' : state === 'stale' ? 'var(--failed)' : 'var(--admin-text-muted)';
              return (
                <div key={s.kind} style={{ padding: '6px 10px', border: `1px solid ${fg}`, borderRadius: 999, background: bg, color: fg, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ textTransform: 'uppercase' }}>{s.kind}</span>
                  <span style={{ fontWeight: 400 }}>· {state} · {label}</span>
                </div>
              );
            });
          })()}
        </div>
      </Panel>
    </AdminShell>
  );
}
