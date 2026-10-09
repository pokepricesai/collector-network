import 'server-only';

// INDEXING rule — surface the latest sitemap snapshot per site if
// its status is not 'ok' or the valid-sampled share has deteriorated
// materially vs the previous snapshot.

import type { IntelligenceRule, RuleContext, RuleOutput } from '../types';

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

export const indexingCoverageRule: IntelligenceRule = {
  id: 'indexing.coverage_issue',
  description: 'Sitemap snapshot shows deterioration or error status.',
  categoriesScanned: ['indexing'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const { data, error } = await ctx.sb
      .from('network_sitemap_snapshots')
      .select('id, site_id, snapshot_at, submitted_count, valid_sampled, issue_count, status, error_summary')
      .order('snapshot_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(`[rules/indexing] fetch snapshots: ${error.message}`);
    const rows = ((data ?? []) as SnapshotRow[]);

    // Latest + previous per site.
    const perSite = new Map<string, { latest: SnapshotRow; prev?: SnapshotRow }>();
    for (const r of rows) {
      const existing = perSite.get(r.site_id);
      if (!existing) perSite.set(r.site_id, { latest: r });
      else if (!existing.prev) existing.prev = r;
    }

    const out: RuleOutput[] = [];
    for (const [site_id, { latest, prev }] of perSite) {
      const site_slug = findSiteSlug(ctx, site_id);
      const site_name = ctx.sites.find((s) => s.id === site_id)?.name ?? site_slug ?? site_id;
      const isError   = latest.status === 'error';
      const isWarning = latest.status === 'warning';
      const sampleDropped = prev ? prev.valid_sampled - latest.valid_sampled : 0;
      // Sample drop ratio only matters if the previous snapshot had
      // enough rows to be a baseline.
      const dropMeaningful = prev != null && prev.valid_sampled >= 50 && sampleDropped >= Math.max(10, prev.valid_sampled * 0.1);

      if (!isError && !isWarning && !dropMeaningful) continue;

      const impact     = isError ? 75 : isWarning ? 55 : 50;
      const confidence = 85;
      const urgency    = isError ? 70 : isWarning ? 45 : 40;
      const effort     = 45;

      out.push({
        source_type: 'indexing',
        source_id: latest.id,
        source_key: `indexing:coverage:${site_slug ?? site_id}`,
        site_id,
        site_slug,
        category: 'indexing',
        type: isError ? 'sitemap_error' : isWarning ? 'sitemap_warning' : 'coverage_deterioration',
        signal_kind: isError ? 'risk' : 'warning',
        title: `${site_name} · ${isError ? 'sitemap error' : isWarning ? 'sitemap warning' : 'coverage deterioration'}`,
        summary: isError || isWarning
          ? `Latest sitemap snapshot status ${latest.status.toUpperCase()}: ${latest.error_summary ?? '(no error_summary logged)'}. ${latest.issue_count} issue(s) across ${latest.submitted_count} submitted URLs.`
          : `Valid-sampled URLs dropped from ${prev?.valid_sampled ?? '?'} to ${latest.valid_sampled} since the previous snapshot — coverage may be deteriorating.`,
        recommended_action: 'Open /admin/seo/sitemaps for this site, inspect the shard-level issues, and verify the inspection queue has caught up.',
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

function findSiteSlug(ctx: RuleContext, site_id: string): import('../types').SiteSlug | null {
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
