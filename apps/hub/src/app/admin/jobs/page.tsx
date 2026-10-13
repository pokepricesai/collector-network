import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { EmptyPanelNotice } from '@/components/admin/EmptyPanelNotice';
import { FreshnessBadge, freshnessState, relativeLabel } from '@/components/admin/FreshnessBadge';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { listJobs, recoverStaleRuns, STALE_RUN_MINUTES } from '@/server/jobs/registry';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { formatInt, formatRelative } from '@/lib/format';
import { jobDisplayName, siteDisplayName } from '@/lib/display-names';
import { RunButton } from './RunButton';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
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

type AggregatedStatus = 'success' | 'warning' | 'partial' | 'failed' | 'running' | 'never';

interface JobAggregate {
  latest: JobRunRow | undefined;
  aggregated: AggregatedStatus;
  siteSuccessCount: number;      // sites with latest run success/warning in 24h window
  siteFailCount: number;         // sites with latest run failed in 24h
  siteTotalCount: number;        // sites that have any run in 24h
  expectedSiteCount: number;     // 5 for per-site network jobs; 0 for truly network-level jobs
  isRunning: boolean;
}

interface PageProps {
  searchParams?: Promise<{ view?: string }>;
}

export default async function JobsPage({ searchParams }: PageProps) {
  const { admin, sb } = await requireAdmin('/admin/jobs');
  const sites = await listNetworkSites(sb);
  const jobs = listJobs();
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const sp = (await searchParams) ?? {};
  const showAll = sp.view === 'all';

  // Opportunistic stale-run recovery before we render.
  const srSb = createServiceRoleSupabase();
  const recovered = await recoverStaleRuns(srSb);

  // Pull last 500 runs; group client-side.
  const { data: runs } = await sb
    .from('network_job_runs')
    .select('id, job_name, status, started_at, finished_at, site_id, rows_inserted, rows_updated, rows_rejected, error_summary, metadata')
    .order('started_at', { ascending: false })
    .limit(500);
  const allRuns = ((runs ?? []) as JobRunRow[]);

  // Index runs per (jobName, siteId) and per jobName alone.
  const perSiteKey = (r: JobRunRow) => r.site_id ? `${r.job_name}|${r.site_id}` : r.job_name;
  const latestPerSite = new Map<string, JobRunRow>();
  const latestPerJob  = new Map<string, JobRunRow>();          // network-level fallback
  const latestPerSiteByJob = new Map<string, Map<string, JobRunRow>>();  // jobName → siteId → latest
  for (const r of allRuns) {
    const k = perSiteKey(r);
    if (!latestPerSite.has(k)) latestPerSite.set(k, r);
    if (!latestPerJob.has(r.job_name)) latestPerJob.set(r.job_name, r);
    if (r.site_id) {
      let m = latestPerSiteByJob.get(r.job_name);
      if (!m) { m = new Map(); latestPerSiteByJob.set(r.job_name, m); }
      if (!m.has(r.site_id)) m.set(r.site_id, r);
    }
  }

  // Match a registry entry to its primary site key when applicable.
  function perSiteKeyForJob(j: typeof jobs[number]): string | null {
    const m = j.slug.match(/^(?:sitemaps|inspection|intel|ideas)\.(\w+)$/);
    if (!m || !m[1]) return null;
    const site = sites.find((s) => s.slug === m[1]);
    return site ? `${j.jobName}|${site.id}` : null;
  }

  // Aggregate across sites for the gsc.sync / ga4.sync kind of
  // registry entry: one per-site run per sync. We call it a
  // 'network-aggregated' job if the registry declares no per-site
  // slug and the recent runs for its jobName have site_id. Partial
  // failures must bubble up — the operator must not see Success if
  // one required site failed.
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
  function aggregateFor(j: typeof jobs[number]): JobAggregate {
    const primaryKey = perSiteKeyForJob(j);
    if (primaryKey) {
      // Per-site registry entry — single site; no aggregation needed.
      const latest = latestPerSite.get(primaryKey);
      return {
        latest,
        aggregated: !latest ? 'never'
                  : latest.status === 'running' ? 'running'
                  : latest.status === 'failed'  ? 'failed'
                  : latest.status === 'warning' ? 'warning'
                  : 'success',
        siteSuccessCount: !latest || latest.status === 'failed' ? 0 : 1,
        siteFailCount:    latest && latest.status === 'failed' ? 1 : 0,
        siteTotalCount:   latest ? 1 : 0,
        expectedSiteCount: 1,
        isRunning:         latest?.status === 'running',
      };
    }

    // Non-per-site registry entry. Two sub-cases:
    //   (a) runs with site_id exist for this jobName → aggregate.
    //   (b) runs are network-level (no site_id) → simple single-run display.
    const perSite = latestPerSiteByJob.get(j.jobName);
    if (perSite && perSite.size > 0) {
      const expectedSites = sites.length;         // all active sites
      let successCount = 0;
      let failCount    = 0;
      let runningAny   = false;
      let newest: JobRunRow | undefined;
      for (const r of perSite.values()) {
        const inWindow = new Date(r.started_at).getTime() >= twentyFourHoursAgo;
        if (!inWindow) continue;
        if (r.status === 'failed')  failCount    += 1;
        else if (r.status === 'running') runningAny = true;
        else successCount += 1;
        if (!newest || r.started_at > newest.started_at) newest = r;
      }
      const totalInWindow = successCount + failCount + (runningAny ? 1 : 0);
      let aggregated: AggregatedStatus;
      if (totalInWindow === 0 && !newest) aggregated = 'never';
      else if (totalInWindow === 0) aggregated = 'never';     // runs older than 24h window
      else if (runningAny) aggregated = 'running';
      else if (failCount === 0) aggregated = 'success';
      else if (successCount === 0) aggregated = 'failed';
      else aggregated = 'partial';
      return {
        latest: newest ?? latestPerJob.get(j.jobName),
        aggregated,
        siteSuccessCount: successCount,
        siteFailCount:    failCount,
        siteTotalCount:   totalInWindow,
        expectedSiteCount: expectedSites,
        isRunning: runningAny,
      };
    }

    // Pure network-level job.
    const latest = latestPerJob.get(j.jobName);
    return {
      latest,
      aggregated: !latest ? 'never' : (latest.status as AggregatedStatus),
      siteSuccessCount: 0,
      siteFailCount: 0,
      siteTotalCount: latest ? 1 : 0,
      expectedSiteCount: 0,
      isRunning: latest?.status === 'running',
    };
  }

  interface Row {
    id: string;
    slug: string;
    jobName: string;
    label: string;
    group: 'ingest' | 'analysis' | 'ops';
    classification: 'scheduled' | 'manual' | 'one_off' | 'backfill' | 'diagnostic' | 'deprecated';
    scheduleLabel: string | null;
    description: string;
    requiresConfirmation?: boolean;
    agg: JobAggregate;
  }
  const rows: Row[] = jobs.map((j): Row => {
    const defaultCls = j.group === 'ops' ? 'manual' : 'scheduled';
    return {
      id: j.slug,
      slug: j.slug,
      jobName: j.jobName,
      label: j.label,
      group: j.group,
      classification: (j.classification as Row['classification'] | undefined) ?? defaultCls,
      scheduleLabel: j.scheduleLabel ?? null,
      description: j.description,
      requiresConfirmation: j.requiresConfirmation,
      agg: aggregateFor(j),
    };
  });

  // Sort within each group: failing / stale / partial first, then
  // running, then success. Within same status, scheduled jobs with
  // a schedule label come before manual.
  function sortRank(r: Row): number {
    if (r.agg.aggregated === 'failed')  return 0;
    if (r.agg.aggregated === 'partial') return 1;
    if (r.agg.aggregated === 'never')   return 2;
    if (r.agg.aggregated === 'warning') return 3;
    if (r.agg.aggregated === 'running') return 4;
    if (r.agg.aggregated === 'success') return 5;
    return 6;
  }
  rows.sort((a, b) => sortRank(a) - sortRank(b) || a.label.localeCompare(b.label));

  // Partition.
  const active   = rows.filter((r) => r.classification !== 'deprecated' && r.classification !== 'diagnostic' && r.classification !== 'backfill');
  const utility  = rows.filter((r) => r.classification === 'diagnostic' || r.classification === 'backfill');
  const deprecated = rows.filter((r) => r.classification === 'deprecated');

  const groupLabel = (g: Row['group']): string => g === 'ingest' ? 'Ingest' : g === 'analysis' ? 'Analysis' : 'Ops';
  const activeByGroup: Record<string, Row[]> = {};
  for (const r of active) {
    (activeByGroup[groupLabel(r.group)] ??= []).push(r);
  }

  // Problem count summary.
  const failing = active.filter((r) => r.agg.aggregated === 'failed' || r.agg.aggregated === 'partial').length;
  const stale   = active.filter((r) => r.agg.aggregated === 'never').length;

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/jobs">
      <SectionHeader
        eyebrow="Operations · Jobs"
        title="Jobs"
        description={
          <>
            Scheduled + manual jobs. Every run writes to <code>network_job_runs</code>. Runs stuck past {STALE_RUN_MINUTES}min are auto-recovered ({recovered} this page load). Failing / stale / partial jobs rise to the top.
            {failing > 0 && <> · <strong style={{ color: 'var(--failed, #c0392b)' }}>{failing} job{failing === 1 ? '' : 's'} failing or partial</strong></>}
            {stale > 0 && <> · <strong style={{ color: 'var(--warning, #e67e22)' }}>{stale} not run in 24h</strong></>}
          </>
        }
        actions={
          <Link href={showAll ? '/admin/jobs' : '/admin/jobs?view=all'} className="ui-btn ui-btn--secondary ui-btn--sm">
            {showAll ? 'Hide utility jobs' : 'Show utility jobs'}
          </Link>
        }
      />

      {(['Ingest', 'Analysis', 'Ops'] as const).map((grp) => (
        activeByGroup[grp]?.length ? (
          <Panel key={grp} title={grp}>
            <JobTable rows={activeByGroup[grp]!} sitesById={sitesById} />
          </Panel>
        ) : null
      ))}

      {showAll && (
        <>
          {utility.length > 0 && (
            <Panel title="Utility jobs" eyebrow="Backfills + diagnostics">
              <JobTable rows={utility} sitesById={sitesById} />
            </Panel>
          )}
          {deprecated.length > 0 && (
            <Panel title="Deprecated jobs" eyebrow="Kept for audit; do not run">
              <JobTable rows={deprecated} sitesById={sitesById} />
            </Panel>
          )}
        </>
      )}
    </AdminShell>
  );
}

function JobTable({ rows, sitesById }: { rows: Array<{
  id: string; slug: string; jobName: string; label: string; group: string;
  classification: 'scheduled' | 'manual' | 'one_off' | 'backfill' | 'diagnostic' | 'deprecated';
  scheduleLabel: string | null; description: string; requiresConfirmation?: boolean;
  agg: JobAggregate;
}>; sitesById: Map<string, { shortName: string; slug: string }> }) {
  return (
    <Table
      columns={[
        { key: 'job', header: 'Job', render: (r) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 13 }}>{r.label}</strong>
              <ClassificationChip classification={r.classification} />
            </div>
            {r.scheduleLabel && <span className="col-dim" style={{ fontSize: 11 }}>{r.scheduleLabel}</span>}
            <details style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
              <summary style={{ cursor: 'pointer', color: 'var(--admin-text-muted)' }}>Details</summary>
              <div style={{ marginTop: 4 }}>
                <div>{r.description}</div>
                <code style={{ fontSize: 10, color: '#888' }}>{r.slug} · {r.jobName}</code>
              </div>
            </details>
          </div>
        ) },
        { key: 'status', header: 'Latest run', render: (r) => {
          const a = r.agg;
          const freshness = a.latest ? freshnessState(a.latest.started_at, { freshHours: 26, agingHours: 48 }) : 'never';
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
              <AggregatedStatusBadge agg={a} />
              {a.latest && <span className="col-dim" style={{ fontSize: 11 }}>{formatRelative(a.latest.started_at)}</span>}
              <FreshnessBadge state={freshness} label={a.latest ? relativeLabel(a.latest.started_at) : 'no run'} />
            </div>
          );
        } },
        { key: 'coverage', header: 'Coverage', render: (r) => {
          const a = r.agg;
          if (a.expectedSiteCount <= 1) return <span className="col-dim" style={{ fontSize: 11 }}>—</span>;
          return (
            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>
              <div><strong style={{ color: 'var(--admin-text)' }}>{a.siteSuccessCount}</strong> ok · <strong style={{ color: a.siteFailCount > 0 ? 'var(--failed)' : 'var(--admin-text)' }}>{a.siteFailCount}</strong> failed · of {a.expectedSiteCount} sites</div>
            </div>
          );
        } },
        { key: 'detail', header: 'Detail', render: (r) => {
          const latest = r.agg.latest;
          if (!latest) return <span className="col-dim">—</span>;
          if (latest.error_summary) {
            return <span style={{ color: 'var(--failed, #8A1C27)', fontSize: 11, maxWidth: 320, display: 'inline-block' }}>{latest.error_summary.slice(0, 200)}</span>;
          }
          return (
            <span className="col-dim" style={{ fontSize: 11 }}>
              {latest.site_id && <>{siteDisplayName(sitesById.get(latest.site_id)?.slug, 'Network')} · </>}
              +{formatInt(latest.rows_inserted)} / ~{formatInt(latest.rows_updated)}
              {latest.rows_rejected > 0 && <> · <span style={{ color: 'var(--failed)' }}>!{latest.rows_rejected}</span></>}
            </span>
          );
        } },
        { key: 'run',   header: '', render: (r) => r.agg.isRunning ? (
          <span className="status-badge status-running" style={{ fontSize: 11 }}>running…</span>
        ) : r.classification === 'deprecated' ? (
          <span className="col-dim" style={{ fontSize: 11 }}>disabled</span>
        ) : <RunButton
              slug={r.slug}
              label={r.label}
              requiresConfirmation={r.requiresConfirmation}
              confirmPrompt={r.requiresConfirmation ? `Run "${r.label}" now? This will scan BigQuery data (~tens of MB) and incur a small cost.` : undefined}
            /> },
      ]}
      rows={rows}
    />
  );
}

function AggregatedStatusBadge({ agg }: { agg: JobAggregate }) {
  const label =
    agg.aggregated === 'success' ? 'Success'
    : agg.aggregated === 'warning' ? 'Warning'
    : agg.aggregated === 'partial' ? 'Partial failure'
    : agg.aggregated === 'failed'  ? 'Failed'
    : agg.aggregated === 'running' ? 'Running'
    : 'Never run';
  const state =
    agg.aggregated === 'success' ? 'success'
    : agg.aggregated === 'warning' ? 'warning'
    : agg.aggregated === 'partial' ? 'warning'
    : agg.aggregated === 'failed'  ? 'failed'
    : agg.aggregated === 'running' ? 'running'
    : 'disabled';
  return <StatusBadge state={state} label={label} />;
}

function ClassificationChip({ classification }: { classification: 'scheduled' | 'manual' | 'one_off' | 'backfill' | 'diagnostic' | 'deprecated' }) {
  const label =
    classification === 'scheduled'  ? 'scheduled'
    : classification === 'manual'   ? 'manual'
    : classification === 'one_off'  ? 'one-off'
    : classification === 'backfill' ? 'backfill'
    : classification === 'diagnostic'? 'diagnostic'
    :                                  'deprecated';
  const color =
    classification === 'scheduled'  ? 'var(--admin-text-muted)'
    : classification === 'manual'   ? 'var(--admin-text-muted)'
    : classification === 'deprecated'? 'var(--failed, #c0392b)'
    :                                   'var(--admin-text-subtle)';
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
      color, padding: '1px 6px', borderRadius: 4, border: `1px solid ${color}`,
    }}>{label}</span>
  );
}
