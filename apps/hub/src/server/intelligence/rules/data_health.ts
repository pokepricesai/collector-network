import 'server-only';

// DATA_HEALTH rules — detect failed or stale ingest/analysis jobs
// using network_job_runs + expected freshness per job_name.

import type { IntelligenceRule, RuleContext, RuleOutput } from '../types';

// Expected freshness per job family (hours). Jobs that haven't
// succeeded within this window trigger a stale alert. Values here
// are intentionally forgiving to avoid false alarms when a weekend
// skips a cron.
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

// Jobs considered CORE to the OS. If stale/failed, urgency is high.
const CORE_JOBS = new Set(['gsc.sync', 'ga4.sync', 'impact.epn.sync']);

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
  description: 'Core ingest/analysis jobs failing or stale beyond their expected cadence.',
  categoriesScanned: ['data_health', 'technical'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    // Latest run per job_name (and per site when relevant).
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await ctx.sb
      .from('network_job_runs')
      .select('id, job_name, job_type, site_id, status, started_at, finished_at, error_summary')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(2000);
    if (error) throw new Error(`[rules/data_health] fetch runs: ${error.message}`);
    const rows = ((data ?? []) as JobRunRow[]);

    // Group by (job_name, site_id). Latest row wins.
    const latest = new Map<string, JobRunRow>();
    for (const r of rows) {
      const key = `${r.job_name}:${r.site_id ?? 'network'}`;
      if (!latest.has(key)) latest.set(key, r);
    }

    const now = new Date(ctx.runAt).getTime();
    const out: RuleOutput[] = [];

    for (const [key, run] of latest) {
      const freshnessHours = EXPECTED_FRESHNESS_HOURS[run.job_name];
      if (freshnessHours == null) continue;             // Un-tracked jobs: ignore
      const lastOk = run.status === 'success' || run.status === 'warning';
      const ageHours = (now - new Date(run.started_at).getTime()) / (1000 * 60 * 60);

      // Count consecutive failures for the same (job, site).
      let consecutiveFailures = 0;
      for (const r of rows) {
        if (`${r.job_name}:${r.site_id ?? 'network'}` !== key) continue;
        if (r.status === 'failed') consecutiveFailures += 1;
        else break;
      }

      const isStale = ageHours > freshnessHours && lastOk;
      const isFailing = !lastOk;
      if (!isStale && !isFailing) continue;

      const core = CORE_JOBS.has(run.job_name);
      const siteSlug = findSiteSlug(ctx, run.site_id);

      // Scoring.
      const impact     = core ? 85 : 55;
      const confidence = 90;
      const urgency    = clamp(
        isFailing ? 70 + consecutiveFailures * 10 : 40 + Math.min(30, (ageHours - freshnessHours) * 1.0),
      );
      const effort     = isFailing ? 45 : 25;

      const title = isFailing
        ? `${core ? 'CORE ' : ''}job failing · ${run.job_name}${siteSlug ? ` · ${siteSlug}` : ''}`
        : `${core ? 'CORE ' : ''}job stale · ${run.job_name}${siteSlug ? ` · ${siteSlug}` : ''}`;
      const summary = isFailing
        ? `Last run status ${run.status.toUpperCase()}${consecutiveFailures > 1 ? `, ${consecutiveFailures} consecutive failures` : ''}. Error: ${run.error_summary ?? '(none logged)'}.`
        : `Last successful run ${ageHours.toFixed(1)}h ago (expected ≤ ${freshnessHours}h). Downstream intelligence will degrade until this runs cleanly.`;

      out.push({
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
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
    }

    return out;
  },
};

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function findSiteSlug(ctx: RuleContext, site_id: string | null): import('../types').SiteSlug | null {
  if (!site_id) return null;
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
