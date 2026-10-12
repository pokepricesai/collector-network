import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { FreshnessBadge, freshnessState, relativeLabel } from '@/components/admin/FreshnessBadge';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { fetchFreshness } from '@/server/analytics/dashboard';
import { formatRelative } from '@/lib/format';
import { jobDisplayName, siteDisplayName } from '@/lib/display-names';

// Health answers one question: "Is the plumbing healthy right now?"
// It is NOT a full job history (that lives on /admin/jobs) nor a
// detailed BigQuery readiness view (that lives in Integrations).

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface JobRow {
  id: string;
  job_name: string;
  job_type: string;
  site_id: string | null;
  status: 'running' | 'success' | 'warning' | 'failed';
  started_at: string;
  finished_at: string | null;
  rows_examined: number;
  rows_inserted: number;
  rows_updated: number;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
}

export default async function HealthPage() {
  const { admin, sb } = await requireAdmin('/admin/health');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const freshness = await fetchFreshness(sb);

  const { data: jobs } = await sb
    .from('network_job_runs')
    .select('id, job_name, job_type, site_id, status, started_at, finished_at, rows_examined, rows_inserted, rows_updated, error_summary, metadata')
    .order('started_at', { ascending: false })
    .limit(50);

  // Latest sitemap snapshot per site.
  const { data: sitemapRecent } = await sb.from('network_sitemap_snapshots')
    .select('site_id, snapshot_at, status, issue_count, submitted_count, error_summary')
    .order('snapshot_at', { ascending: false })
    .limit(50);
  const sitemapRows = (sitemapRecent ?? []) as Array<{ site_id: string; snapshot_at: string; status: string; issue_count: number; submitted_count: number; error_summary: string | null }>;
  const latestSitemapBySite = new Map<string, typeof sitemapRows[number]>();
  for (const r of sitemapRows) if (!latestSitemapBySite.has(r.site_id)) latestSitemapBySite.set(r.site_id, r);

  const rows = (jobs ?? []) as JobRow[];

  // Per-source freshness (collapse the per-property rows).
  interface SourceFreshness {
    source: 'GSC' | 'GA4';
    through: string | null;
    state: 'fresh' | 'aging' | 'stale' | 'never';
    propertyCount: number;
  }
  const bySource = new Map<string, SourceFreshness>();
  for (const f of freshness) {
    const key = f.kind.toUpperCase();
    const prev = bySource.get(key);
    const latest = f.lastDataDate ?? null;
    const current = prev ?? {
      source: key as 'GSC' | 'GA4',
      through: null,
      state: 'never' as const,
      propertyCount: 0,
    };
    current.propertyCount += 1;
    if (latest && (!current.through || latest > current.through)) current.through = latest;
    bySource.set(key, current);
  }
  // Resolve state per source: GSC fresh ≤5d, aging ≤8d; GA4 ≤2d, ≤4d.
  for (const [k, s] of bySource) {
    const thresholds = k === 'GSC' ? { freshHours: 72, agingHours: 120 } : { freshHours: 48, agingHours: 96 };
    const ageIso = s.through ? new Date(s.through).toISOString() : null;
    s.state = freshnessState(ageIso, thresholds);
    bySource.set(k, s);
  }

  // Active issues panel: core failures + stale sources + sitemap errors.
  const corePending = rows.filter((j) => j.status === 'failed' && (j.job_name === 'gsc.incremental' || j.job_name === 'ga4.incremental' || j.job_name === 'impact.epn.sync' || j.job_name === 'intelligence.refresh')).slice(0, 10);
  const sitemapErrorList = Array.from(latestSitemapBySite.entries())
    .filter(([_, s]) => s.status === 'error')
    .map(([site_id, s]) => ({ site_id, snapshot: s }));
  const staleSources = Array.from(bySource.values()).filter((s) => s.state === 'stale' || s.state === 'never');
  const allHealthy = corePending.length === 0 && sitemapErrorList.length === 0 && staleSources.length === 0;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/health">
      <SectionHeader
        eyebrow="Operations"
        title="Network health"
        description="Is the plumbing healthy right now? Core job state + source freshness + sitemap health. Full job history lives on Jobs; BigQuery readiness lives on Integrations."
      />

      <Panel title={allHealthy ? 'All systems healthy' : 'Active issues'}>
        {allHealthy ? (
          <EmptyPanelNotice>
            Core syncs are current, sitemap snapshots are OK, and no core jobs failed on their latest run.
          </EmptyPanelNotice>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {corePending.length > 0 && (
              <div style={{ padding: '10px 12px', background: 'var(--failed-soft, #FBE5E7)', border: '1px solid var(--failed, #c0392b)', borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Core jobs failing</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12 }}>
                  {corePending.map((j) => (
                    <li key={j.id}>
                      {jobDisplayName(j.job_name)} {j.site_id ? `· ${siteDisplayName(sitesById.get(j.site_id)?.slug, 'Network')}` : ''} — {j.error_summary?.slice(0, 160) ?? 'no error summary logged'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {sitemapErrorList.length > 0 && (
              <div style={{ padding: '10px 12px', background: 'var(--failed-soft, #FBE5E7)', border: '1px solid var(--failed, #c0392b)', borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Sitemap errors</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12 }}>
                  {sitemapErrorList.map(({ site_id, snapshot }) => (
                    <li key={`sm-${site_id}`}>
                      {siteDisplayName(sitesById.get(site_id)?.slug, 'Site')} — {snapshot.issue_count} issue{snapshot.issue_count === 1 ? '' : 's'} across {snapshot.submitted_count} submitted URLs. {snapshot.error_summary ?? ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {staleSources.length > 0 && (
              <div style={{ padding: '10px 12px', background: 'var(--warning-soft, #FFF4E5)', border: '1px solid var(--warning, #e67e22)', borderRadius: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Stale sources</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12 }}>
                  {staleSources.map((s) => (
                    <li key={s.source}>
                      {s.source} — latest data through {s.through ?? 'never'}; expected to run daily.
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Source freshness" eyebrow="Daily sync feeds">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {Array.from(bySource.values()).map((s) => (
            <div key={s.source} style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, border: '1px solid var(--admin-border)', borderRadius: 6, minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <strong style={{ fontSize: 13 }}>{s.source}</strong>
                <FreshnessBadge state={s.state} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
                {s.through ? `through ${s.through}` : 'never synced'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--admin-text-subtle)' }}>
                {s.propertyCount} propert{s.propertyCount === 1 ? 'y' : 'ies'}
              </div>
            </div>
          ))}
        </div>
        <details style={{ marginTop: 10, fontSize: 11, color: 'var(--admin-text-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>Per-property detail</summary>
          <Table
            columns={[
              { key: 'site',   header: 'Site',         render: (r: typeof freshness[number] & { id: string }) => siteDisplayName(r.slug, 'Network') },
              { key: 'kind',   header: 'Source',       render: (r) => r.kind.toUpperCase() },
              { key: 'date',   header: 'Data through', render: (r) => r.lastDataDate ?? <span className="col-dim">—</span> },
              { key: 'sync',   header: 'Last sync',    render: (r) => formatRelative(r.lastSyncAt) },
              { key: 'prop',   header: 'Property',     render: (r) => <code style={{ fontSize: 10 }}>{r.propertyId}</code> },
            ]}
            rows={freshness.map((f, i) => ({ ...f, id: `${f.siteId}-${f.kind}-${i}` }))}
          />
        </details>
      </Panel>

      <Panel title="Sitemap health" eyebrow="Latest snapshot per site" actions={<Link href="/admin/seo/sitemaps" className="ui-btn ui-btn--secondary ui-btn--sm">Open sitemaps</Link>}>
        <Table
          columns={[
            { key: 'site',  header: 'Site',     render: (s: typeof sites[number]) => siteDisplayName(s.slug, 'Network') },
            { key: 'state', header: 'Snapshot', render: (s) => {
              const snap = latestSitemapBySite.get(s.id);
              return snap ? <StatusBadge state={snap.status === 'ok' ? 'connected' : snap.status === 'warning' ? 'warning' : 'failed'} label={snap.status} /> : <span className="col-dim">no snapshot</span>;
            } },
            { key: 'subm',  header: 'Submitted URLs', className: 'col-num', render: (s) => {
              const snap = latestSitemapBySite.get(s.id);
              return snap ? snap.submitted_count.toLocaleString() : '—';
            } },
            { key: 'iss',   header: 'Issues', className: 'col-num', render: (s) => {
              const snap = latestSitemapBySite.get(s.id);
              return snap ? snap.issue_count.toLocaleString() : '—';
            } },
            { key: 'when',  header: 'When', render: (s) => {
              const snap = latestSitemapBySite.get(s.id);
              return snap ? <FreshnessBadge state={freshnessState(snap.snapshot_at, { freshHours: 48, agingHours: 72 })} label={relativeLabel(snap.snapshot_at)} /> : <span className="col-dim">—</span>;
            } },
          ]}
          rows={sites.map((s) => ({ ...s, id: s.id }))}
        />
      </Panel>

      <Panel
        title="Core job status"
        eyebrow={`Latest ${Math.min(10, rows.length)} runs`}
        actions={<Link href="/admin/jobs" className="ui-btn ui-btn--secondary ui-btn--sm">Open Jobs</Link>}
      >
        {rows.length === 0 ? (
          <EmptyPanelNotice>No jobs have run yet.</EmptyPanelNotice>
        ) : (
          <Table
            columns={[
              { key: 'name',   header: 'Job',       render: (j: JobRow) => <span style={{ fontWeight: 600 }}>{jobDisplayName(j.job_name)}</span> },
              { key: 'site',   header: 'Site',      render: (j) => <span className="col-dim">{j.site_id ? siteDisplayName(sitesById.get(j.site_id)?.slug, 'Network') : 'Network'}</span> },
              { key: 'status', header: 'Status',    render: (j) => <StatusBadge state={j.status} /> },
              { key: 'started',header: 'Started',   render: (j) => formatRelative(j.started_at) },
              { key: 'detail', header: 'Detail',    render: (j) => j.error_summary ? <span style={{ color: 'var(--failed, #8A1C27)', fontSize: 11 }}>{j.error_summary.slice(0, 100)}</span> : <span className="col-dim" style={{ fontSize: 11 }}>+{j.rows_inserted} / ~{j.rows_updated}</span> },
            ]}
            rows={rows.slice(0, 10)}
          />
        )}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--admin-text-muted)' }}>
          BigQuery readiness + export configuration moved to <Link href="/admin/integrations">Integrations</Link>.
        </div>
      </Panel>
    </AdminShell>
  );
}
