import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { AdminShell } from '@/components/admin/AdminShell';
import {
  EmptyState, Panel, SectionHeader, StatusBadge, Table,
} from '@/components/admin/admin-ui';

export const dynamic = 'force-dynamic';

interface JobRow {
  id: string;
  job_name: string;
  job_type: string;
  status: 'running' | 'success' | 'warning' | 'failed';
  site_id: string | null;
  started_at: string;
  finished_at: string | null;
  rows_examined: number;
  rows_inserted: number;
  rows_updated: number;
  rows_rejected: number;
  error_summary: string | null;
}

export default async function AutomationPage() {
  const { admin, sb } = await requireAdmin('/admin/automation');
  const sites = await listNetworkSites(sb);
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  const { data, error } = await sb
    .from('network_job_runs')
    .select('id, job_name, job_type, status, site_id, started_at, finished_at, rows_examined, rows_inserted, rows_updated, rows_rejected, error_summary')
    .order('started_at', { ascending: false })
    .limit(100);

  const rows: JobRow[] = (error || !data ? [] : (data as JobRow[]));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/automation">
      <SectionHeader
        eyebrow="Operations"
        title="Automation centre"
        description="Every background job that writes to the OS registers a run here. Rows begin to appear as later phases enable ingestion."
      />
      <Panel>
        <Table
          columns={[
            { key: 'job',    header: 'Job',       render: (j) => <span style={{ fontWeight: 600 }}>{j.job_name}</span> },
            { key: 'type',   header: 'Type',      render: (j) => <span className="col-dim">{j.job_type}</span> },
            { key: 'site',   header: 'Site',      render: (j) => <span className="col-dim">{j.site_id ? (sitesById.get(j.site_id)?.name ?? '—') : 'Network'}</span> },
            { key: 'status', header: 'Status',    render: (j) => <StatusBadge state={j.status} /> },
            { key: 'rows',   header: 'Rows (in/upd/rej)', className: 'col-num col-dim',
              render: (j) => `${j.rows_inserted} / ${j.rows_updated} / ${j.rows_rejected}` },
            { key: 'start',  header: 'Started',   render: (j) => <span className="col-dim">{new Date(j.started_at).toISOString().replace('T', ' ').slice(0, 16)}</span> },
          ]}
          rows={rows}
          empty={<EmptyState title="No job runs yet" description="Phase 1's GSC + GA ingestion is the first scheduled job and will populate this timeline." tone="muted" />}
        />
      </Panel>
    </AdminShell>
  );
}
