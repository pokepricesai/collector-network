import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listJobs } from '@/server/jobs/registry';
import { formatInt, formatRelative } from '@/lib/format';
import { RunButton } from './RunButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface JobRunRow {
  id: string;
  job_name: string;
  status: 'running' | 'success' | 'warning' | 'failed';
  started_at: string;
  finished_at: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_rejected: number;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
}

// Server component. Lists the fixed allowlist of Collector Network
// jobs and, for each, the latest run (manual or scheduled). The Run
// button lives inside RunButton (client component) and dispatches a
// server action; no HTTP self-call, no secret shuttling.

export default async function JobsPage() {
  const { admin, sb } = await requireAdmin('/admin/jobs');
  const sites = await listNetworkSites(sb);
  const jobs = listJobs();

  // Pull the most-recent 500 job runs; we group client-side to find
  // the latest per job_name.
  const { data: runs } = await sb
    .from('network_job_runs')
    .select('id, job_name, status, started_at, finished_at, rows_inserted, rows_updated, rows_rejected, error_summary, metadata')
    .order('started_at', { ascending: false })
    .limit(500);
  const latest = new Map<string, JobRunRow>();
  const runningByName = new Map<string, number>();
  for (const r of ((runs ?? []) as JobRunRow[])) {
    if (r.status === 'running') {
      runningByName.set(r.job_name, (runningByName.get(r.job_name) ?? 0) + 1);
    }
    if (!latest.has(r.job_name)) latest.set(r.job_name, r);
  }

  interface Row {
    id: string;
    slug: string;
    jobName: string;
    label: string;
    group: 'ingest' | 'analysis' | 'ops';
    description: string;
    requiresConfirmation?: boolean;
    latest: JobRunRow | undefined;
    isRunning: boolean;
  }
  const rows: Row[] = jobs.map((j) => ({
    id: j.slug,
    slug: j.slug,
    jobName: j.jobName,
    label: j.label,
    group: j.group,
    description: j.description,
    requiresConfirmation: j.requiresConfirmation,
    latest: latest.get(j.jobName),
    isRunning: (runningByName.get(j.jobName) ?? 0) > 0,
  }));

  // Group jobs by category for a readable layout.
  const byGroup = {
    ingest:   rows.filter((r) => r.group === 'ingest'),
    analysis: rows.filter((r) => r.group === 'analysis'),
    ops:      rows.filter((r) => r.group === 'ops'),
  };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/jobs">
      <SectionHeader
        eyebrow="Operations · Jobs"
        title="Jobs"
        description="Scheduled Collector Network jobs. Every run — manual or cron — writes to network_job_runs so the latest status is always visible here. Manual runs are audit-logged. BigQuery jobs track bytes billed."
      />

      {([
        ['Ingest',   byGroup.ingest],
        ['Analysis', byGroup.analysis],
        ['Ops',      byGroup.ops],
      ] as Array<[string, Row[]]>).map(([title, items]) => (
        items.length === 0 ? null : (
          <Panel key={title} title={title} eyebrow="Jobs">
            <Table<Row>
              columns={[
                { key: 'job', header: 'Job', render: (r) => (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                    <strong style={{ fontSize: 13 }}>{r.label}</strong>
                    <span className="col-dim" style={{ fontSize: 11 }}>{r.description}</span>
                    <code style={{ fontSize: 10, color: '#888' }}>{r.jobName}</code>
                  </div>
                ) },
                { key: 'status', header: 'Last run', render: (r) => r.latest ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                    <StatusBadge state={r.latest.status} />
                    <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(r.latest.started_at)}</span>
                    {r.latest.finished_at && <span className="col-dim" style={{ fontSize: 10 }}>took {Math.round((new Date(r.latest.finished_at).getTime() - new Date(r.latest.started_at).getTime()) / 1000)}s</span>}
                  </div>
                ) : <span className="col-dim">never</span> },
                { key: 'rows',  header: 'Rows', className: 'col-num', render: (r) => r.latest ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: 11 }}>
                    <span>+{formatInt(r.latest.rows_inserted)} / ~{formatInt(r.latest.rows_updated)}</span>
                    {r.latest.rows_rejected > 0 && <span style={{ color: '#8A1C27' }}>!{r.latest.rows_rejected}</span>}
                  </div>
                ) : <span className="col-dim">—</span> },
                { key: 'bq',    header: 'BQ bytes', className: 'col-num', render: (r) => {
                  const m = r.latest?.metadata ?? {};
                  const fmt = (m as { bq_bytes_billed_fmt?: string }).bq_bytes_billed_fmt;
                  return fmt ? <span style={{ fontSize: 11 }}>{fmt}</span> : <span className="col-dim">—</span>;
                } },
                { key: 'err',   header: 'Error', render: (r) => r.latest?.error_summary ? <span style={{ color: '#8A1C27', fontSize: 11, maxWidth: 300, display: 'inline-block' }}>{r.latest.error_summary.slice(0, 160)}</span> : <span className="col-dim">—</span> },
                { key: 'run',   header: '',       render: (r) => r.isRunning ? (
                  <span className="status-badge status-running" style={{ fontSize: 11 }}>running…</span>
                ) : <RunButton
                      slug={r.slug}
                      label={r.label}
                      requiresConfirmation={r.requiresConfirmation}
                      confirmPrompt={r.requiresConfirmation ? `Run "${r.label}" now? This will scan BigQuery data (~tens of MB) and incur a small cost.` : undefined}
                    /> },
              ]}
              rows={items}
            />
          </Panel>
        )
      ))}
    </AdminShell>
  );
}
