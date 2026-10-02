import { AdminShell } from '@/components/admin/AdminShell';
import { EmptyState, Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { fetchFreshness } from '@/server/analytics/dashboard';
import { formatRelative } from '@/lib/format';

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
}

export default async function HealthPage() {
  const { admin, sb } = await requireAdmin('/admin/health');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const freshness = await fetchFreshness(sb);

  const { data: jobs } = await sb
    .from('network_job_runs')
    .select('id, job_name, job_type, site_id, status, started_at, finished_at, rows_examined, rows_inserted, rows_updated, error_summary')
    .order('started_at', { ascending: false })
    .limit(50);

  const rows = (jobs ?? []) as JobRow[];

  // Alert state — any freshness entry whose last_data_date is >5 days
  // behind "yesterday" (GSC) or >3 days behind (GA4) is stale.
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const staleRows = freshness.filter((f) => {
    if (!f.lastDataDate) return false; // never-synced is handled separately
    const d = new Date(f.lastDataDate);
    const diffDays = Math.round((yesterday.getTime() - d.getTime()) / 86400000);
    const threshold = f.kind === 'gsc' ? 5 : 3;
    return diffDays > threshold;
  });
  const neverSyncedRows = freshness.filter((f) => !f.lastDataDate);

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/health">
      <SectionHeader
        eyebrow="Health"
        title="Network health"
        description="Sync job runs, source freshness and stale-feed alerts across the five Collector Network platforms."
      />

      {(staleRows.length > 0 || neverSyncedRows.length > 0) && (
        <Panel title="Freshness alerts" eyebrow="Attention">
          <div style={{ display: 'grid', gap: 8 }}>
            {neverSyncedRows.map((r) => (
              <div key={`ns-${r.siteId}-${r.kind}`} style={{ padding: '8px 10px', background: '#FBE5E7', border: '1px solid #E8B1B7', borderRadius: 6, fontSize: 12 }}>
                <strong>{r.slug}</strong> · {r.kind.toUpperCase()} · never synced. Property <code>{r.propertyId}</code> is configured but has no data yet.
              </div>
            ))}
            {staleRows.map((r) => (
              <div key={`sr-${r.siteId}-${r.kind}`} style={{ padding: '8px 10px', background: '#FFF4E5', border: '1px solid #F0CFA0', borderRadius: 6, fontSize: 12 }}>
                <strong>{r.slug}</strong> · {r.kind.toUpperCase()} · data through {r.lastDataDate} (last synced {formatRelative(r.lastSyncAt)}). Behind the expected freshness threshold.
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Source freshness" eyebrow="Feeds">
        <Table
          columns={[
            { key: 'site',   header: 'Site',         render: (r: typeof freshness[number] & { id: string }) => r.slug },
            { key: 'kind',   header: 'Source',       render: (r) => r.kind.toUpperCase() },
            { key: 'prop',   header: 'Property',     render: (r) => <code>{r.propertyId}</code> },
            { key: 'date',   header: 'Data through', render: (r) => r.lastDataDate ?? <span className="col-dim">—</span> },
            { key: 'sync',   header: 'Last sync',    render: (r) => formatRelative(r.lastSyncAt) },
            { key: 'status', header: 'Status',       render: (r) => <StatusBadge state={r.status as 'active'} /> },
          ]}
          rows={freshness.map((f, i) => ({ ...f, id: `${f.siteId}-${f.kind}-${i}` }))}
        />
      </Panel>

      <Panel title="Recent job runs" eyebrow="Jobs">
        <Table
          columns={[
            { key: 'name',   header: 'Job',       render: (j: JobRow) => <span style={{ fontWeight: 600 }}>{j.job_name}</span> },
            { key: 'site',   header: 'Site',      render: (j) => <span className="col-dim">{j.site_id ? (sitesById.get(j.site_id)?.shortName ?? '—') : 'Network'}</span> },
            { key: 'status', header: 'Status',    render: (j) => <StatusBadge state={j.status} /> },
            { key: 'rows',   header: 'Rows',      className: 'col-num', render: (j) => `${j.rows_inserted + j.rows_updated}` },
            { key: 'started',header: 'Started',   render: (j) => formatRelative(j.started_at) },
            { key: 'took',   header: 'Took',      className: 'col-num', render: (j) => j.finished_at ? `${Math.round((new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000)}s` : '…' },
            { key: 'err',    header: 'Error',     render: (j) => j.error_summary ? <span style={{ color: '#8A1C27', fontSize: 11 }}>{j.error_summary.slice(0, 100)}</span> : <span className="col-dim">—</span> },
          ]}
          rows={rows}
          empty={<EmptyState title="No jobs yet" description="Job runs appear here as GSC + GA4 syncs execute." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
