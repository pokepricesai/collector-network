import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listJobs, recoverStaleRuns, STALE_RUN_MINUTES } from '@/server/jobs/registry';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { formatInt, formatRelative } from '@/lib/format';
import { RunButton } from './RunButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Server actions on this page can run multi-minute jobs. Raise the
// serverless-function budget so a single invocation isn't killed
// before it can finalise its own job_run row.
export const maxDuration = 300;

interface JobRunRow {
  id: string;
  job_name: string;
  status: 'running' | 'success' | 'warning' | 'failed';
  started_at: string;
  finished_at: string | null;
  site_id: string | null;
  rows_inserted: number;
  rows_updated: number;
  rows_rejected: number;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
}

export default async function JobsPage() {
  const { admin, sb } = await requireAdmin('/admin/jobs');
  const sites = await listNetworkSites(sb);
  const jobs = listJobs();
  const sitesById = new Map(sites.map((s) => [s.id, s]));

  // Opportunistic stale-run recovery before we render. Reads
  // network_job_runs through the service-role client; the admin's
  // own session has already been verified.
  const srSb = createServiceRoleSupabase();
  const recovered = await recoverStaleRuns(srSb);

  // Pull the most-recent 500 job runs; we group client-side to find
  // the latest per (job_name, site_id).
  const { data: runs } = await sb
    .from('network_job_runs')
    .select('id, job_name, status, started_at, finished_at, site_id, rows_inserted, rows_updated, rows_rejected, error_summary, metadata')
    .order('started_at', { ascending: false })
    .limit(500);
  const latestBySlug = new Map<string, JobRunRow>();
  const runningBySlug = new Map<string, number>();

  // Build the "latest run" key per job in the registry. For per-site
  // jobs (sitemaps.pokemon, sitemaps.mtg, ...) we have one jobName
  // ('sitemap.check') split across 5 site_ids. For jobs with no
  // site_id (bq.analysis, brief.build, etc.) the key is just jobName.
  function keyForRun(r: JobRunRow): string {
    return r.site_id ? `${r.job_name}|${r.site_id}` : r.job_name;
  }
  function keyForJob(j: typeof jobs[number]): string {
    // Per-site jobs encode the site slug after the first dot:
    //   sitemaps.pokemon, inspection.mtg, intel.ygo, ...
    const siteSuffixMatch = j.slug.match(/^(?:sitemaps|inspection|intel)\.(\w+)$/);
    if (siteSuffixMatch && siteSuffixMatch[1]) {
      const site = sites.find((s) => s.slug === siteSuffixMatch[1]);
      return site ? `${j.jobName}|${site.id}` : j.jobName;
    }
    return j.jobName;
  }
  for (const r of ((runs ?? []) as JobRunRow[])) {
    const k = keyForRun(r);
    if (r.status === 'running') runningBySlug.set(k, (runningBySlug.get(k) ?? 0) + 1);
    if (!latestBySlug.has(k)) latestBySlug.set(k, r);
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
  const rows: Row[] = jobs.map((j) => {
    const k = keyForJob(j);
    return {
      id: j.slug,
      slug: j.slug,
      jobName: j.jobName,
      label: j.label,
      group: j.group,
      description: j.description,
      requiresConfirmation: j.requiresConfirmation,
      latest: latestBySlug.get(k),
      isRunning: (runningBySlug.get(k) ?? 0) > 0,
    };
  });

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
        description={`Scheduled Collector Network jobs. Every run — manual or cron — writes to network_job_runs so the latest status is always visible here. Runs stuck past ${STALE_RUN_MINUTES}min are auto-recovered (last recovery: ${recovered} rows this page load). Duplicate concurrent runs of the same job are blocked.`}
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
                    <code style={{ fontSize: 10, color: '#888' }}>{r.slug}</code>
                  </div>
                ) },
                { key: 'status', header: 'Last run', render: (r) => r.latest ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start' }}>
                    <StatusBadge state={r.latest.status} />
                    <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(r.latest.started_at)}</span>
                    {r.latest.finished_at ? (
                      <span className="col-dim" style={{ fontSize: 10 }}>took {Math.round((new Date(r.latest.finished_at).getTime() - new Date(r.latest.started_at).getTime()) / 1000)}s</span>
                    ) : r.latest.status === 'running' ? (
                      <span className="col-dim" style={{ fontSize: 10, color: '#8A6A1C' }}>running {Math.round((Date.now() - new Date(r.latest.started_at).getTime()) / 1000)}s…</span>
                    ) : null}
                    {r.latest.site_id && (
                      <code style={{ fontSize: 10, color: '#888' }}>site: {sitesById.get(r.latest.site_id)?.shortName ?? r.latest.site_id.slice(0, 8)}</code>
                    )}
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
                { key: 'err',   header: 'Error / detail', render: (r) => {
                  const m = r.latest?.metadata as Record<string, unknown> | null;
                  if (r.latest?.error_summary) {
                    return <span style={{ color: '#8A1C27', fontSize: 11, maxWidth: 320, display: 'inline-block' }}>{r.latest.error_summary.slice(0, 220)}</span>;
                  }
                  if (m && (m.submitted != null || m.shards != null)) {
                    return <span className="col-dim" style={{ fontSize: 11 }}>{String(m.submitted ?? '')} URLs · {String(m.shards ?? '')} shards · {String(m.issues ?? 0)} issues</span>;
                  }
                  return <span className="col-dim">—</span>;
                } },
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
