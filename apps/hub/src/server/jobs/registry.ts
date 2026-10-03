import 'server-only';

// Centralised Collector Network job registry.
//
// Both the scheduled cron routes under /api/sync/* AND the manual
// /admin/jobs page invoke jobs through here. Benefits:
//
//   • Fixed allowlist. Nothing outside this module can be executed
//     as a "job" from the admin UI; no arbitrary route invocation.
//   • Every run — manual or scheduled — writes to network_job_runs
//     through the SAME wrapper, so the operator view is consistent.
//   • CRON_SECRET never leaves server code. The admin page relies on
//     requireAdmin() and this module uses the service-role Supabase
//     client server-side only.
//   • Job metadata (name, description, est. cost, requires-confirm)
//     lives next to the executor.
//
// Convention: `slug` = programmatic identifier (`sitemaps.check`),
// `jobName` = value we write into network_job_runs.job_name so that
// scheduled and manual runs appear in the same operator view.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceRoleSupabase } from '../admin/service-role';
import { syncAllGsc, syncAllGa4 } from '../google/sync';
import { generateOpportunities } from '../opportunities/engine';
import { runSitemapCheck, recordSitemapSnapshot, type SiteDescriptor } from '../sitemaps/engine';
import { buildInspectionQueue, processInspectionQueue } from '../inspection/engine';
import { generateInternalLinkOpportunities } from '../internal-links/engine';
import { generatePageOpportunities } from '../page-opportunities/engine';
import { runPokepricesBqAnalysis, bigqueryDiagnostic } from '../bigquery/analysis';
import { estimateBqCostUsd, formatBqBytes } from '../google/bigquery';
import { buildBrief } from '../brief/engine';

// The five sites are hard-coded here to keep the allowlist static.
// Resolution to real UUIDs happens inside each run().
const SITE_SLUGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'] as const;
type SiteSlug = typeof SITE_SLUGS[number];

async function loadSiteDescriptor(sb: SupabaseClient, slug: SiteSlug): Promise<SiteDescriptor> {
  const { data, error } = await sb.from('network_sites')
    .select('id, slug, canonical_url').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`[jobs] load site ${slug}: ${error.message}`);
  if (!data) throw new Error(`[jobs] site ${slug} not found`);
  return { id: data.id as string, slug: data.slug as string, canonicalUrl: data.canonical_url as string };
}

/** Shared per-site sitemap executor. Writes one job_run per invocation
 *  with site_id set, keeping manual + cron entries uniform. Returns
 *  metrics for the outer wrapper (there isn't one — wrapsOuter=false). */
async function runSitemapForOneSite(sb: SupabaseClient, slug: SiteSlug): Promise<{
  rowsInserted: number;
  rowsExamined: number;
  rowsRejected: number;
  summary: Record<string, unknown>;
  metadata: Record<string, unknown>;
}> {
  const site = await loadSiteDescriptor(sb, slug);
  const jobStart = Date.now();
  const { data: jobId } = await sb.rpc('network_start_job_run', {
    p_job_name: 'sitemap.check',
    p_job_type: 'sync',
    p_site_id: site.id,
    p_metadata: { site: slug, trigger: 'per-site' } as unknown as Record<string, unknown>,
  });
  try {
    const result = await runSitemapCheck(site);
    const { snapshotId } = await recordSitemapSnapshot(sb, site, result);
    await sb.rpc('network_complete_job_run', {
      p_id: jobId,
      p_status: result.issues.some((i) => i.severity === 'error') ? 'warning' : 'success',
      p_rows_examined: result.submittedCount,
      p_rows_inserted: 1,
      p_rows_updated: 0,
      p_rows_rejected: result.issues.filter((i) => i.severity === 'error').length,
      p_error_summary: result.errorSummary,
      p_metadata: {
        snapshot_id: snapshotId,
        shards: result.shardCount,
        submitted: result.submittedCount,
        valid_sampled: result.validSampled,
        issues: result.issues.length,
        duration_ms: result.durationMs,
        budget_exceeded: result.budgetExceeded,
      } as unknown as Record<string, unknown>,
    });
    return {
      rowsInserted: 1,
      rowsExamined: result.submittedCount,
      rowsRejected: result.issues.filter((i) => i.severity === 'error').length,
      summary: { site: slug, submitted: result.submittedCount, valid: result.validSampled, issues: result.issues.length, shards: result.shardCount, duration_ms: result.durationMs },
      metadata: { site: slug, snapshot_id: snapshotId, duration_ms: result.durationMs, budget_exceeded: result.budgetExceeded },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await sb.rpc('network_fail_job_run', {
      p_id: jobId,
      p_error_summary: msg.slice(0, 500),
      p_metadata: { site: slug, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
    });
    throw err;
  }
}

export interface JobRunResult {
  ok: boolean;
  slug: string;
  jobName: string;
  jobRunId: string | null;
  durationMs: number;
  summary: Record<string, unknown>;
  rowsInserted: number;
  rowsUpdated: number;
  rowsExamined: number;
  rowsRejected: number;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
}

export interface JobDefinition {
  slug: string;
  jobName: string;
  group: 'ingest' | 'analysis' | 'ops';
  label: string;
  description: string;
  requiresConfirmation?: boolean;
  // Null = don't wrap in an outer job_run (inner functions manage
  // their own entries, so wrapping would double-count).
  wrapsOuter: boolean;
  // The executor. Receives a service-role Supabase client and
  // returns the metrics we care about recording. The wrapper
  // handles network_job_runs.
  run: (sb: SupabaseClient) => Promise<{
    rowsInserted?: number;
    rowsUpdated?: number;
    rowsExamined?: number;
    rowsRejected?: number;
    metadata?: Record<string, unknown>;
    summary: Record<string, unknown>;
  }>;
}

// --- JOB DEFINITIONS -----------------------------------------------
export const JOBS: Record<string, JobDefinition> = {
  'gsc.sync': {
    slug: 'gsc.sync',
    jobName: 'gsc.incremental',
    group: 'ingest',
    label: 'GSC sync (incremental)',
    description: 'Sliding-window re-fetch of GSC metrics across all five sites. Creates one job_run per property. ~30s typical.',
    wrapsOuter: false,
    run: async (sb) => {
      const r = await syncAllGsc(sb, new Date());
      return {
        rowsInserted: r.totals.site_daily + r.totals.url_daily + r.totals.query_daily + r.totals.url_query_daily,
        summary: r as unknown as Record<string, unknown>,
      };
    },
  },
  'ga4.sync': {
    slug: 'ga4.sync',
    jobName: 'ga4.incremental',
    group: 'ingest',
    label: 'GA4 sync (incremental)',
    description: 'Sliding-window re-fetch of GA4 daily metrics across all five sites.',
    wrapsOuter: false,
    run: async (sb) => {
      const r = await syncAllGa4(sb, new Date());
      return { rowsInserted: r.totals.rows, summary: r as unknown as Record<string, unknown> };
    },
  },
  'opportunities.generate': {
    slug: 'opportunities.generate',
    jobName: 'opportunities.generate',
    group: 'analysis',
    label: 'SEO opportunities',
    description: 'Deterministic SEO opportunity rules over 28d GSC data. Should run after a GSC sync.',
    wrapsOuter: true,
    run: async (sb) => {
      const r = await generateOpportunities(sb, new Date());
      return {
        rowsInserted: r.generated,
        rowsUpdated: r.updated,
        summary: r as unknown as Record<string, unknown>,
      };
    },
  },
  'sitemaps.pokemon': {
    slug: 'sitemaps.pokemon', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · PokePrices',
    description: 'Checks PokePrices sitemap root + shards + bounded HEAD probes. ~60s budget. Writes one network_sitemap_snapshots row.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'pokemon'),
  },
  'sitemaps.mtg': {
    slug: 'sitemaps.mtg', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · MTGPrices',
    description: 'Checks MTGPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'mtg'),
  },
  'sitemaps.ygo': {
    slug: 'sitemaps.ygo', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · YGOPrices',
    description: 'Checks YGOPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'ygo'),
  },
  'sitemaps.onepiece': {
    slug: 'sitemaps.onepiece', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · OnePiecePrices',
    description: 'Checks OnePiecePrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'onepiece'),
  },
  'sitemaps.lorcana': {
    slug: 'sitemaps.lorcana', jobName: 'sitemap.check', group: 'analysis',
    label: 'Sitemap check · LorcanaPrices',
    description: 'Checks LorcanaPrices sitemap root + shards + bounded HEAD probes.',
    wrapsOuter: false,
    run: async (sb) => runSitemapForOneSite(sb, 'lorcana'),
  },
  'inspection.cycle': {
    slug: 'inspection.cycle',
    jobName: 'inspection.cycle',
    group: 'analysis',
    label: 'URL inspection cycle',
    description: 'Rebuilds the inspection queue from current state, then processes up to 50 URLs per site. Quota-aware.',
    wrapsOuter: false,
    run: async (sb) => {
      const { data: props, error } = await sb
        .from('network_google_properties')
        .select('site_id, property_id, network_sites!inner(slug)')
        .eq('kind', 'gsc')
        .eq('status', 'active');
      if (error) throw new Error(`[jobs/inspection] load props: ${error.message}`);
      const rows = (props ?? []) as unknown as Array<{ site_id: string; property_id: string; network_sites: { slug: string } }>;
      const perSite: Array<{ site: string; enqueued: number; processed: number; inspected: number; quotaExceeded: boolean; errors: number }> = [];
      let totalInspected = 0;
      let totalErrors = 0;
      for (const r of rows) {
        const jobStart = Date.now();
        const { data: jobId } = await sb.rpc('network_start_job_run', {
          p_job_name: 'inspection.cycle',
          p_job_type: 'sync',
          p_site_id: r.site_id,
          p_metadata: { property_id: r.property_id } as unknown as Record<string, unknown>,
        });
        try {
          const { enqueued } = await buildInspectionQueue(sb, r.site_id);
          const res = await processInspectionQueue(sb, r.site_id, r.property_id, 50);
          perSite.push({ site: r.network_sites.slug, enqueued, processed: res.processed, inspected: res.inspected, quotaExceeded: res.quotaExceeded, errors: res.errors.length });
          totalInspected += res.inspected;
          totalErrors += res.errors.length;
          await sb.rpc('network_complete_job_run', {
            p_id: jobId,
            p_status: res.errors.length === 0 && !res.quotaExceeded ? 'success' : 'warning',
            p_rows_examined: res.processed,
            p_rows_inserted: res.inspected,
            p_rows_updated: 0,
            p_rows_rejected: res.errors.length,
            p_error_summary: res.quotaExceeded ? 'quota exceeded' : null,
            p_metadata: { enqueued, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
          totalErrors++;
        }
      }
      return {
        rowsInserted: totalInspected,
        rowsRejected: totalErrors,
        summary: { perSite },
        metadata: { per_site: perSite },
      };
    },
  },
  'intel.links_and_pages': {
    slug: 'intel.links_and_pages',
    jobName: 'intel.links_and_pages',
    group: 'analysis',
    label: 'Internal links + page opportunities',
    description: 'Internal-link opportunity engine (orphan / authority_handoff / query_cluster) + per-TCG page-opportunity engine. Needs GSC data to be useful.',
    wrapsOuter: false,
    run: async (sb) => {
      const { data: sites, error } = await sb
        .from('network_sites')
        .select('id, slug')
        .eq('status', 'active');
      if (error) throw new Error(`[jobs/intel] load sites: ${error.message}`);
      const rows = (sites ?? []) as Array<{ id: string; slug: string }>;
      const today = new Date();
      const perSite: Array<{ site: string; internal: { generated: number; updated: number }; pages: { generated: number; updated: number } }> = [];
      let totalInserted = 0, totalUpdated = 0;
      for (const s of rows) {
        const jobStart = Date.now();
        const { data: jobId } = await sb.rpc('network_start_job_run', {
          p_job_name: 'intel.links_and_pages',
          p_job_type: 'analysis',
          p_site_id: s.id,
          p_metadata: {} as unknown as Record<string, unknown>,
        });
        try {
          const [internal, pages] = await Promise.all([
            generateInternalLinkOpportunities(sb, s.id, today),
            generatePageOpportunities(sb, s.slug, s.id, today),
          ]);
          perSite.push({ site: s.slug, internal, pages });
          totalInserted += internal.generated + pages.generated;
          totalUpdated += internal.updated + pages.updated;
          await sb.rpc('network_complete_job_run', {
            p_id: jobId,
            p_status: 'success',
            p_rows_examined: 0,
            p_rows_inserted: internal.generated + pages.generated,
            p_rows_updated: internal.updated + pages.updated,
            p_rows_rejected: 0,
            p_error_summary: null,
            p_metadata: { internal, pages, duration_ms: Date.now() - jobStart } as unknown as Record<string, unknown>,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
        }
      }
      return {
        rowsInserted: totalInserted,
        rowsUpdated: totalUpdated,
        summary: { perSite },
        metadata: { per_site: perSite },
      };
    },
  },
  'bq.pokeprices_analysis': {
    slug: 'bq.pokeprices_analysis',
    jobName: 'bq.pokeprices_analysis',
    group: 'analysis',
    label: 'BigQuery deep SEO analysis',
    description: 'Runs cannibalisation + content-gap queries against pokeprices-seo. Scans ~tens of MB of GSC bulk export data. Costs are tracked.',
    requiresConfirmation: true,
    wrapsOuter: true,
    run: async (sb) => {
      const { data: pokemon } = await sb.from('network_sites').select('id').eq('slug', 'pokemon').maybeSingle();
      if (!pokemon) throw new Error('pokemon site not found in network_sites');
      const r = await runPokepricesBqAnalysis(sb, (pokemon as { id: string }).id);
      const estCost = estimateBqCostUsd(r.bytesBilled);
      // Flip the pokeprices BQ integration to connected on first success.
      await sb.from('network_integrations').update({
        status: 'connected',
        last_success_at: new Date().toISOString(),
        last_attempt_at: new Date().toISOString(),
        error_summary: null,
      }).eq('provider', 'bigquery');
      return {
        rowsInserted: r.cannibalFindings + r.gapFindings,
        summary: {
          queries: r.queries,
          cannibalisation_findings: r.cannibalFindings,
          content_gap_findings: r.gapFindings,
          bytes_processed: r.bytesProcessed,
          bytes_billed: r.bytesBilled,
          estimated_cost_usd: Number(estCost.toFixed(6)),
        },
        metadata: {
          bq_bytes_processed: r.bytesProcessed,
          bq_bytes_billed: r.bytesBilled,
          bq_bytes_processed_fmt: formatBqBytes(r.bytesProcessed),
          bq_bytes_billed_fmt: formatBqBytes(r.bytesBilled),
          bq_est_cost_usd: Number(estCost.toFixed(6)),
          queries: r.queries,
        },
      };
    },
  },
  'bq.diagnostic': {
    slug: 'bq.diagnostic',
    jobName: 'bq.diagnostic',
    group: 'ops',
    label: 'BigQuery diagnostic probe',
    description: 'Low-cost probe: confirms the WIF chain to BigQuery works and pokeprices-seo datasets are visible. Scans <100MB.',
    wrapsOuter: true,
    run: async (sb) => {
      const r = await bigqueryDiagnostic();
      // Record probe outcome on the integration row.
      await sb.from('network_integrations').update({
        status: r.ok ? 'connected' : 'error',
        last_success_at: r.ok ? new Date().toISOString() : null,
        last_attempt_at: new Date().toISOString(),
        error_summary: r.ok ? null : (r.error ?? 'unknown'),
      }).eq('provider', 'bigquery');
      await sb.from('network_bigquery_readiness').update({
        gsc_export_status: r.ok ? 'connected' : 'error',
        last_checked_at: new Date().toISOString(),
      }).eq('gcp_project_id', 'pokeprices-seo');
      if (!r.ok) throw new Error(r.error ?? 'bigquery diagnostic failed');
      return {
        rowsExamined: r.sampleRows,
        summary: {
          datasets_visible: r.datasetsVisible,
          sample_rows: r.sampleRows,
          bytes_processed: r.bytesProcessed,
          bytes_billed: r.bytesBilled,
        },
        metadata: {
          bq_bytes_processed: r.bytesProcessed,
          bq_bytes_billed: r.bytesBilled,
          bq_bytes_processed_fmt: formatBqBytes(r.bytesProcessed),
          bq_bytes_billed_fmt: formatBqBytes(r.bytesBilled),
          datasets_visible: r.datasetsVisible,
        },
      };
    },
  },
  'brief.build': {
    slug: 'brief.build',
    jobName: 'brief.build',
    group: 'analysis',
    label: 'Daily operating brief',
    description: 'Composes today\'s brief: network yesterday, notable changes, top 5 actions. Persists to network_daily_briefs so /admin reads instantly.',
    wrapsOuter: true,
    run: async (sb) => {
      const b = await buildBrief(sb, new Date());
      const { error } = await sb
        .from('network_daily_briefs')
        .upsert({ for_date: b.forDate, payload: b as unknown as Record<string, unknown> }, { onConflict: 'for_date' });
      if (error) throw new Error(`upsert brief: ${error.message}`);
      return {
        rowsInserted: 1,
        summary: {
          for_date: b.forDate,
          actions: b.actions.length,
          notable: b.notable.length,
          top_sources: b.countsByCategory,
        },
        metadata: {
          for_date: b.forDate,
          actions: b.actions.length,
          notable: b.notable.length,
        },
      };
    },
  },
};

export function listJobs(): JobDefinition[] {
  return Object.values(JOBS);
}

/** Minutes after which a `running` job_run is considered abandoned. The
 *  Vercel function budget is 5 minutes; any job stuck past that was
 *  killed mid-flight and will never finalise itself. */
export const STALE_RUN_MINUTES = 10;

/**
 * Scan network_job_runs for entries stuck in `running` past the stale
 * threshold and mark them failed. Returns the count recovered. Safe to
 * call on every /admin/jobs page render.
 */
export async function recoverStaleRuns(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data, error } = await sb
    .from('network_job_runs')
    .select('id, job_name, started_at')
    .eq('status', 'running')
    .lt('started_at', cutoff);
  if (error) return 0;
  const rows = (data ?? []) as Array<{ id: string; job_name: string; started_at: string }>;
  let recovered = 0;
  for (const r of rows) {
    const minutes = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000);
    await sb.rpc('network_fail_job_run', {
      p_id: r.id,
      p_error_summary: `stale-run recovery: ${minutes} minutes without finalisation. Likely killed by Vercel function budget. Not an application error — operator can re-trigger safely.`,
      p_metadata: { recovered_at: new Date().toISOString(), recovery: 'auto', minutes_running: minutes } as unknown as Record<string, unknown>,
    });
    recovered++;
  }
  return recovered;
}

/** Is a job already running right now? Returns the current running
 *  entry if so, otherwise null. Scoped by job_name since manual +
 *  cron share the same job_name. */
export async function findRunningJob(sb: SupabaseClient, jobName: string): Promise<{ id: string; started_at: string } | null> {
  // Running past STALE_RUN_MINUTES is treated as abandoned, so we
  // only block on fresh running entries.
  const freshCutoff = new Date(Date.now() - STALE_RUN_MINUTES * 60_000).toISOString();
  const { data } = await sb
    .from('network_job_runs')
    .select('id, started_at')
    .eq('status', 'running').eq('job_name', jobName)
    .gt('started_at', freshCutoff)
    .order('started_at', { ascending: false })
    .limit(1).maybeSingle();
  return (data as { id: string; started_at: string } | null) ?? null;
}

/**
 * Execute a job by slug using the service-role Supabase client.
 *
 * Writes an outer network_job_runs entry when the JobDefinition
 * doesn't manage its own per-item entries (wrapsOuter=true). For
 * jobs that loop per-site/property, the inner function creates
 * entries already; we skip the outer wrapper to avoid double-count.
 */
export async function runJobBySlug(slug: string): Promise<JobRunResult> {
  const def = JOBS[slug];
  if (!def) throw new Error(`[jobs] unknown job: ${slug}`);
  const sb = createServiceRoleSupabase();

  // Opportunistic stale-run recovery, then duplicate-run check.
  await recoverStaleRuns(sb);
  const alreadyRunning = await findRunningJob(sb, def.jobName);
  if (alreadyRunning) {
    const ageSec = Math.round((Date.now() - new Date(alreadyRunning.started_at).getTime()) / 1000);
    return {
      ok: false, slug, jobName: def.jobName, jobRunId: alreadyRunning.id,
      durationMs: 0, summary: {},
      rowsInserted: 0, rowsUpdated: 0, rowsExamined: 0, rowsRejected: 0,
      errorSummary: `another run of ${def.jobName} is already in progress (${ageSec}s old, id=${alreadyRunning.id.slice(0, 8)})`,
      metadata: { reason: 'duplicate_run_blocked', existing_run_id: alreadyRunning.id },
    };
  }

  const started = Date.now();
  let jobRunId: string | null = null;
  if (def.wrapsOuter) {
    const { data } = await sb.rpc('network_start_job_run', {
      p_job_name: def.jobName,
      p_job_type: def.group === 'ingest' ? 'sync' : def.group === 'analysis' ? 'analysis' : 'maintenance',
      p_site_id: null,
      p_metadata: { trigger: 'admin.jobs' } as unknown as Record<string, unknown>,
    });
    jobRunId = (data as string | null) ?? null;
  }
  try {
    const r = await def.run(sb);
    const durationMs = Date.now() - started;
    const rowsInserted = r.rowsInserted ?? 0;
    const rowsUpdated = r.rowsUpdated ?? 0;
    const rowsExamined = r.rowsExamined ?? 0;
    const rowsRejected = r.rowsRejected ?? 0;
    if (jobRunId) {
      await sb.rpc('network_complete_job_run', {
        p_id: jobRunId,
        p_status: 'success',
        p_rows_examined: rowsExamined,
        p_rows_inserted: rowsInserted,
        p_rows_updated: rowsUpdated,
        p_rows_rejected: rowsRejected,
        p_error_summary: null,
        p_metadata: ({ ...(r.metadata ?? {}), duration_ms: durationMs, trigger: 'admin.jobs' } as unknown) as Record<string, unknown>,
      });
    }
    return {
      ok: true, slug, jobName: def.jobName, jobRunId, durationMs,
      summary: r.summary, rowsInserted, rowsUpdated, rowsExamined, rowsRejected,
      errorSummary: null, metadata: r.metadata ?? {},
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - started;
    if (jobRunId) {
      await sb.rpc('network_fail_job_run', {
        p_id: jobRunId,
        p_error_summary: msg.slice(0, 500),
        p_metadata: { duration_ms: durationMs, trigger: 'admin.jobs' } as unknown as Record<string, unknown>,
      });
    }
    return {
      ok: false, slug, jobName: def.jobName, jobRunId, durationMs,
      summary: {}, rowsInserted: 0, rowsUpdated: 0, rowsExamined: 0, rowsRejected: 0,
      errorSummary: msg, metadata: {},
    };
  }
}
