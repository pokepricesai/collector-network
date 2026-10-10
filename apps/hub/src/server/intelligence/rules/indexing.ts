import 'server-only';

// INDEXING rule — surface the latest sitemap snapshot per site when
// there is a real indexing concern. Phase 1.1 split out the mixed
// signals so operators see the actual severity:
//
//   • `sitemap_fetch_error` (impact 80) — snapshot status='error';
//     Google could not fetch / parse the sitemap or the host.
//   • `inspection_sample_warning` (impact 45) — snapshot
//     status='warning' with issue_count ≤ 10; isolated per-URL
//     inspection sampling issues, usually recoverable.
//   • `coverage_deterioration` (impact 55) — valid-sampled URL count
//     dropped meaningfully vs the prior snapshot even though the
//     latest status itself may be ok. This is the one that detects
//     a slow bleed in indexed coverage.
//
// We no longer call every snapshot with issue_count > 0 a "sitemap
// error" — "7 shard-level issues across 1,403 submitted URLs" is a
// sampler artefact, not a sitemap error.

import type {
  IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, RuleScopeDiagnostic, SiteSlug,
} from '../types';

interface SnapshotRow {
  id: string;
  site_id: string;
  snapshot_at: string;
  submitted_count: number;
  valid_sampled: number;
  issue_count: number;
  status: 'ok' | 'warning' | 'error';
  error_summary: string | null;
}

const SAMPLE_FLOOR         = 50;
const COVERAGE_DROP_RATIO  = 0.1;
const COVERAGE_DROP_ABS    = 10;
const SAMPLE_WARNING_CAP   = 10;   // issue_count ≤ this → sampler warning, not real error

export const indexingCoverageRule: IntelligenceRule = {
  id: 'indexing.coverage_issue',
  description: 'Latest sitemap snapshot shows a real fetch error, a bounded sampler warning, or coverage deterioration vs the prior snapshot.',
  categoriesScanned: ['indexing'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const outputs: RuleOutput[] = [];
    const { data, error } = await ctx.sb
      .from('network_sitemap_snapshots')
      .select('id, site_id, snapshot_at, submitted_count, valid_sampled, issue_count, status, error_summary')
      .order('snapshot_at', { ascending: false })
      .limit(100);
    if (error) {
      return { outputs: [], diagnostics: [{ scope: 'network', status: 'error', items_emitted: 0, error: error.message }] };
    }
    const rows = ((data ?? []) as SnapshotRow[]);
    const perSite = new Map<SiteSlug, RuleScopeDiagnostic>();
    for (const s of ctx.sites) perSite.set(s.slug, { scope: s.slug, status: 'no_data', items_emitted: 0, reason: 'no sitemap snapshots for this site' });

    // Latest + previous per site.
    const grouped = new Map<string, { latest: SnapshotRow; prev?: SnapshotRow }>();
    for (const r of rows) {
      const existing = grouped.get(r.site_id);
      if (!existing) grouped.set(r.site_id, { latest: r });
      else if (!existing.prev) existing.prev = r;
    }

    for (const [site_id, { latest, prev }] of grouped) {
      const site_slug = findSiteSlug(ctx, site_id);
      const site_name = ctx.sites.find((s) => s.id === site_id)?.name ?? site_slug ?? site_id;
      const d = site_slug ? perSite.get(site_slug) : null;
      if (d) { d.rows_examined = 1; d.status = 'no_signal'; d.reason = 'latest snapshot ok and coverage stable'; }

      const isHardError    = latest.status === 'error';
      const isSoftWarning  = latest.status === 'warning' && latest.issue_count <= SAMPLE_WARNING_CAP;
      const isLargeWarning = latest.status === 'warning' && latest.issue_count > SAMPLE_WARNING_CAP;
      const sampleDropped  = prev ? prev.valid_sampled - latest.valid_sampled : 0;
      const dropMeaningful = prev != null
        && prev.valid_sampled >= SAMPLE_FLOOR
        && sampleDropped >= Math.max(COVERAGE_DROP_ABS, prev.valid_sampled * COVERAGE_DROP_RATIO);

      if (!isHardError && !isSoftWarning && !isLargeWarning && !dropMeaningful) continue;

      // Choose primary type by severity.
      let type: 'sitemap_fetch_error' | 'inspection_sample_warning' | 'coverage_deterioration';
      let signal: 'risk' | 'warning' = 'warning';
      let impact: number;
      let urgency: number;
      let effort = 45;
      if (isHardError) {
        type = 'sitemap_fetch_error';
        signal = 'risk';
        impact = 80;
        urgency = 70;
      } else if (isLargeWarning) {
        type = 'inspection_sample_warning';
        signal = 'warning';
        impact = 55;
        urgency = 50;
      } else if (dropMeaningful) {
        type = 'coverage_deterioration';
        signal = 'warning';
        impact = 55;
        urgency = 45;
      } else {
        type = 'inspection_sample_warning';
        signal = 'warning';
        impact = 45;
        urgency = 35;
      }

      const confidence = 85;
      const titleCore =
        type === 'sitemap_fetch_error'       ? 'sitemap fetch error' :
        type === 'inspection_sample_warning' ? 'inspection sampler warning' :
                                               'coverage deterioration';
      const summary =
        type === 'sitemap_fetch_error'
          ? `Latest sitemap snapshot status ERROR: ${latest.error_summary ?? '(no error_summary logged)'}. ${latest.issue_count} issue(s) across ${latest.submitted_count} submitted URLs.`
          : type === 'inspection_sample_warning'
          ? `Snapshot status ${latest.status.toUpperCase()} with ${latest.issue_count} issue(s) across ${latest.submitted_count} submitted URLs — most likely isolated per-URL inspection noise, not a sitemap failure.`
          : `Valid-sampled URLs dropped from ${prev?.valid_sampled ?? '?'} to ${latest.valid_sampled} since the previous snapshot — coverage may be deteriorating.`;

      outputs.push({
        source_type: 'indexing',
        source_id: latest.id,
        source_key: `indexing:coverage:${site_slug ?? site_id}`,
        site_id,
        site_slug,
        category: 'indexing',
        type,
        signal_kind: signal,
        title: `${site_name} · ${titleCore}`,
        summary,
        recommended_action: type === 'sitemap_fetch_error'
          ? 'Open /admin/seo/sitemaps for this site. Confirm the sitemap URL responds 200, re-submit to Search Console, and investigate the fetch/parse error.'
          : type === 'coverage_deterioration'
            ? 'Review which URLs dropped out of the valid set. Spot-check the inspection queue and verify indexable URLs are not being deindexed.'
            : 'Open /admin/seo/sitemaps for this site, inspect the shard-level issues, and verify the inspection queue has caught up.',
        evidence: {
          snapshot_id: latest.id,
          snapshot_at: latest.snapshot_at,
          status: latest.status,
          submitted: latest.submitted_count,
          valid_sampled: latest.valid_sampled,
          issue_count: latest.issue_count,
          error_summary: latest.error_summary,
          prev_valid_sampled: prev?.valid_sampled,
          sample_dropped: sampleDropped,
          classification: type,
        },
        impact,
        confidence,
        urgency,
        effort,
        expected_upside: null,
      });
      if (d) { d.status = 'signals_found'; d.items_emitted = 1; d.reason = undefined; }
    }

    return { outputs, diagnostics: Array.from(perSite.values()) };
  },
};

function findSiteSlug(ctx: RuleContext, site_id: string): SiteSlug | null {
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
