import 'server-only';

// DATA_HEALTH rules — detect failed or stale ingest/analysis jobs
// using network_job_runs + expected freshness per job_name.
//
// Phase 1.1 — Changes:
//
//   1. AGGREGATION. One underlying scheduler failure (e.g. the
//      sitemap.check cron is paused) used to emit N near-identical
//      per-site cards. We now coalesce: if a non-core job is stale
//      across ≥3 sites, surface ONE network-wide item listing the
//      affected sites. Site-specific stale items still render when
//      the issue is scoped to a single site.
//
//   2. SITE-HEALTH-WEIGHTED IMPACT. "Public site is healthy, a
//      monitoring cron just hasn't run" is now scored lower than a
//      core ingestion failure. Core jobs (gsc/ga4/epn/analysis) keep
//      their original high impact; non-core stale monitoring jobs
//      drop to impact=35.
//
//   3. DIAGNOSTICS. Explicit per-scope outcome: SIGNALS_FOUND /
//      NO_SIGNAL / NO_DATA.

import type {
  IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, RuleScopeDiagnostic, SiteSlug,
} from '../types';

// Expected freshness per job family (hours). Jobs that haven't
// succeeded within this window trigger a stale alert.
const EXPECTED_FRESHNESS_HOURS: Record<string, number> = {
  'gsc.sync':                36,
  'ga4.sync':                36,
  'sitemap.check':           36,
  'inspection.cycle':        72,
  'opportunities.generate':  48,
  'content.ideas':           72,
  'intel.links_and_pages':   48,
  'impact.epn.sync':         36,
  'impact.invoices.sync':   168,
  'bq.pokeprices_analysis': 168,
};

// Jobs considered CORE to the OS. If stale/failed, urgency is high
// and impact is high (public site functionality or revenue tracking
// depends on them).
const CORE_JOBS = new Set(['gsc.sync', 'ga4.sync', 'impact.epn.sync', 'bq.pokeprices_analysis']);

// Minimum per-site count that triggers aggregation into a single
// network-wide card. Below this, keep per-site cards.
const AGGREGATION_SITE_FLOOR = 3;

interface JobRunRow {
  id: string;
  job_name: string;
  job_type: string;
  site_id: string | null;
  status: 'running' | 'success' | 'warning' | 'failed';
  started_at: string;
  finished_at: string | null;
  error_summary: string | null;
}

export const stalejobRule: IntelligenceRule = {
  id: 'data_health.stale_job',
  description: 'Core ingest/analysis jobs failing or stale beyond their expected cadence. Shared cron failures aggregate network-wide.',
  categoriesScanned: ['data_health', 'technical'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await ctx.sb
      .from('network_job_runs')
      .select('id, job_name, job_type, site_id, status, started_at, finished_at, error_summary')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(2000);
    if (error) {
      return {
        outputs: [],
        diagnostics: [{ scope: 'network', status: 'error', items_emitted: 0, error: error.message }],
      };
    }
    const rows = ((data ?? []) as JobRunRow[]);
    if (rows.length === 0) {
      return {
        outputs: [],
        diagnostics: [{ scope: 'network', status: 'no_data', items_emitted: 0, reason: 'network_job_runs has no rows in the last 14d — the whole job-logging surface may be dead' }],
      };
    }

    // Group by (job_name, site_id). Latest row wins.
    const latest = new Map<string, JobRunRow>();
    for (const r of rows) {
      const key = `${r.job_name}:${r.site_id ?? 'network'}`;
      if (!latest.has(key)) latest.set(key, r);
    }

    const now = new Date(ctx.runAt).getTime();
    // Phase 1: classify each latest run.
    interface Finding {
      run: JobRunRow;
      isFailing: boolean;
      isStale: boolean;
      ageHours: number;
      consecutiveFailures: number;
    }
    const findings: Finding[] = [];
    for (const [key, run] of latest) {
      const freshnessHours = EXPECTED_FRESHNESS_HOURS[run.job_name];
      if (freshnessHours == null) continue;
      const lastOk = run.status === 'success' || run.status === 'warning';
      const ageHours = (now - new Date(run.started_at).getTime()) / (1000 * 60 * 60);
      let consecutiveFailures = 0;
      for (const r of rows) {
        if (`${r.job_name}:${r.site_id ?? 'network'}` !== key) continue;
        if (r.status === 'failed') consecutiveFailures += 1;
        else break;
      }
      const isStale = ageHours > freshnessHours && lastOk;
      const isFailing = !lastOk;
      if (!isStale && !isFailing) continue;
      findings.push({ run, isFailing, isStale, ageHours, consecutiveFailures });
    }

    // Phase 2: aggregate stale (not failing) non-core jobs that span
    // ≥ AGGREGATION_SITE_FLOOR sites — those are almost always ONE
    // cron that's dead rather than N independent site problems.
    const staleByJobName = new Map<string, Finding[]>();
    for (const f of findings) {
      if (!f.isStale) continue;
      if (CORE_JOBS.has(f.run.job_name)) continue;
      if (!f.run.site_id) continue;
      const arr = staleByJobName.get(f.run.job_name) ?? [];
      arr.push(f);
      staleByJobName.set(f.run.job_name, arr);
    }
    const consumedForAggregate = new Set<Finding>();
    for (const [jobName, group] of staleByJobName) {
      if (group.length < AGGREGATION_SITE_FLOOR) continue;
      // Aggregate into one network card.
      const affectedSites = group
        .map((f) => findSiteSlug(ctx, f.run.site_id))
        .filter((s): s is SiteSlug => s != null)
        .sort();
      const maxAge = Math.max(...group.map((f) => f.ageHours));
      const minAge = Math.min(...group.map((f) => f.ageHours));
      const freshnessHours = EXPECTED_FRESHNESS_HOURS[jobName]!;
      const impact     = 45;                                     // monitoring, not core
      const confidence = 90;
      const urgency    = clamp(45 + Math.min(25, (maxAge - freshnessHours) * 0.8));
      const effort     = 25;
      outputs.push({
        source_type: 'job',
        source_id: null,
        source_key: `data_health:stale_job:aggregate:${jobName}`,
        site_id: null,
        site_slug: null,
        category: 'data_health',
        type: 'stale_job_network',
        signal_kind: 'warning',
        title: `job stale network-wide · ${jobName} · ${affectedSites.length} sites`,
        summary: `${jobName} has not run cleanly across ${affectedSites.length} sites (${affectedSites.join(', ')}) for ${minAge.toFixed(0)}-${maxAge.toFixed(0)}h vs ${freshnessHours}h expected. Likely one scheduler stalled — fixing the cron fixes every site.`,
        recommended_action: 'Open /admin/jobs → inspect this job family. Trigger once; if it runs cleanly the cron is paused and needs rescheduling.',
        evidence: {
          job_name: jobName,
          expected_freshness_hours: freshnessHours,
          affected_sites: affectedSites,
          affected_count: affectedSites.length,
          age_hours_min: minAge,
          age_hours_max: maxAge,
          aggregated_from: group.length,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      for (const f of group) consumedForAggregate.add(f);
    }

    // Phase 3: emit remaining per-site items (failing OR non-aggregated stale).
    for (const f of findings) {
      if (consumedForAggregate.has(f)) continue;
      const { run, isFailing, ageHours, consecutiveFailures } = f;
      const freshnessHours = EXPECTED_FRESHNESS_HOURS[run.job_name]!;
      const core = CORE_JOBS.has(run.job_name);
      const siteSlug = findSiteSlug(ctx, run.site_id);
      // Site-health-weighted impact: non-core stale monitoring is
      // routine; core failure IS the site.
      const impact = isFailing
        ? (core ? 85 : 55)
        : (core ? 70 : 35);
      const confidence = 90;
      const urgency    = clamp(
        isFailing ? 60 + consecutiveFailures * 10 : 40 + Math.min(30, (ageHours - freshnessHours) * 1.0),
      );
      const effort = isFailing ? 45 : 25;
      const title = isFailing
        ? `${core ? 'CORE ' : ''}job failing · ${run.job_name}${siteSlug ? ` · ${siteSlug}` : ''}`
        : `${core ? 'CORE ' : ''}job stale · ${run.job_name}${siteSlug ? ` · ${siteSlug}` : ''}`;
      const summary = isFailing
        ? `Last run status ${run.status.toUpperCase()}${consecutiveFailures > 1 ? `, ${consecutiveFailures} consecutive failures` : ''}. Error: ${run.error_summary ?? '(none logged)'}.`
        : `Last successful run ${ageHours.toFixed(1)}h ago (expected ≤ ${freshnessHours}h). Downstream intelligence will degrade until this runs cleanly.`;

      outputs.push({
        source_type: 'job',
        source_id: run.id,
        source_key: `data_health:stale_job:${run.job_name}:${run.site_id ?? 'network'}`,
        site_id: run.site_id,
        site_slug: siteSlug,
        category: 'data_health',
        type: isFailing ? 'failed_job' : 'stale_job',
        signal_kind: isFailing ? 'risk' : 'warning',
        title,
        summary,
        recommended_action: isFailing
          ? 'Open /admin/jobs → inspect error. If credentials/quota: fix root cause then re-run. If upstream outage: wait + retry.'
          : 'Trigger the job manually from /admin/jobs, or wait for the next scheduled window if the cron is paused.',
        evidence: {
          job_name: run.job_name,
          site_id: run.site_id,
          status: run.status,
          started_at: run.started_at,
          finished_at: run.finished_at,
          age_hours: ageHours,
          expected_freshness_hours: freshnessHours,
          consecutive_failures: consecutiveFailures,
          error: run.error_summary,
          is_core: core,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
    }

    const diag: RuleScopeDiagnostic = outputs.length > 0
      ? {
          scope: 'network',
          status: 'signals_found',
          rows_examined: findings.length,
          items_emitted: outputs.length,
          reason: `aggregated ${consumedForAggregate.size} per-site stale items into ${outputs.filter((o) => o.type === 'stale_job_network').length} network cards`,
        }
      : { scope: 'network', status: 'no_signal', rows_examined: findings.length, items_emitted: 0, reason: 'all tracked jobs are current' };
    return { outputs, diagnostics: [diag] };
  },
};

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function findSiteSlug(ctx: RuleContext, site_id: string | null): SiteSlug | null {
  if (!site_id) return null;
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
