import 'server-only';

// CONTENT rules.
//
// I. High-value article opportunity — reads network_content_ideas
//    where score >= 60, decision != 'skip', no hold_reasons.
// J. Article performance (existing published pieces that under-
//    perform) — skipped for Phase 1 because we don't yet reliably
//    link GSC URLs → article records across all five sites. Will be
//    added once the publisher adapters canonicalise URLs.

import type { IntelligenceRule, RuleContext, RuleOutput } from '../types';

interface IdeaRow {
  id: string;
  site_id: string;
  working_title: string;
  content_type: string;
  score: number | null;
  decision: string | null;
  hold_reasons: string[] | null;
  autopilot_state: string | null;
  status: string;
  scored_at: string | null;
  updated_at: string;
}

export const highValueOpportunityRule: IntelligenceRule = {
  id: 'content.high_value_opportunity',
  description: 'Autopilot has a strong eligible article candidate (score ≥ 60, no holds, decision != skip).',
  categoriesScanned: ['content'],
  async run(ctx: RuleContext): Promise<RuleOutput[]> {
    const { data, error } = await ctx.sb
      .from('network_content_ideas')
      .select('id, site_id, working_title, content_type, score, decision, hold_reasons, autopilot_state, status, scored_at, updated_at')
      .in('status', ['new', 'in_brief'])
      .gte('score', 60)
      .order('score', { ascending: false })
      .limit(100);
    if (error) throw new Error(`[rules/content] fetch ideas: ${error.message}`);

    const rows = ((data ?? []) as IdeaRow[]).filter((r) => {
      if ((r.hold_reasons?.length ?? 0) > 0) return false;
      if (r.decision && r.decision === 'skip') return false;
      return true;
    });

    const out: RuleOutput[] = [];
    for (const r of rows) {
      const site_slug = findSiteSlug(ctx, r.site_id);
      const score = r.score ?? 0;
      const impact     = clamp(40 + score * 0.5);                   // score 60 → 70; 80 → 80
      const confidence = clamp(50 + score * 0.3);
      const urgency    = r.autopilot_state === 'queued' ? 55 : 40;
      const effort     = r.decision === 'refresh' ? 25 : 55;         // refresh is cheaper than new article
      out.push({
        source_type: 'content',
        source_id: r.id,
        source_key: `content:high_value_opportunity:${site_slug ?? 'network'}:${r.id}`,
        site_id: r.site_id,
        site_slug,
        category: 'content',
        type: 'high_value_opportunity',
        tone: 'opportunity',
        title: `Eligible article opportunity · ${site_slug ?? 'network'} (${score}/100)`,
        summary: `"${trim(r.working_title, 80)}" · template ${r.content_type} · decision ${r.decision ?? '—'} · state ${r.autopilot_state ?? 'new'}.`,
        recommended_action: r.decision === 'refresh'
          ? 'Refresh the existing article. Autopilot can generate the diff when enabled.'
          : 'Review the research pack at /admin/content/autopilot/preview. Approve a paid draft only when ready to spend.',
        evidence: {
          idea_id: r.id,
          working_title: r.working_title,
          content_type: r.content_type,
          score: r.score,
          decision: r.decision,
          autopilot_state: r.autopilot_state,
          scored_at: r.scored_at,
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
function trim(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function findSiteSlug(ctx: RuleContext, site_id: string): import('../types').SiteSlug | null {
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
