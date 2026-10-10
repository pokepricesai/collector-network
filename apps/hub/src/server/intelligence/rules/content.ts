import 'server-only';

// CONTENT rules.
//
// I. High-value article opportunity — reads network_content_ideas
//    where score >= 60, decision != 'skip', no hold_reasons.
// J. Article performance (existing published pieces) — only on
//    sites with the DB-target convention; others silently skipped
//    until their canonical URL is known.
//
// Phase 1.1: per-scope diagnostics so operators see NO_DATA vs
// NO_SIGNAL vs SKIPPED.

import type {
  IntelligenceRule, RuleContext, RuleOutput, RuleRunResult, RuleScopeDiagnostic, SiteSlug,
} from '../types';

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
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const { data, error } = await ctx.sb
      .from('network_content_ideas')
      .select('id, site_id, working_title, content_type, score, decision, hold_reasons, autopilot_state, status, scored_at, updated_at')
      .in('status', ['new', 'in_brief'])
      .gte('score', 60)
      .order('score', { ascending: false })
      .limit(100);
    if (error) {
      return { outputs: [], diagnostics: [{ scope: 'network', status: 'error', items_emitted: 0, error: error.message }] };
    }

    const outputs: RuleOutput[] = [];
    const perSite = new Map<SiteSlug, { examined: number; emitted: number }>();
    for (const s of ctx.sites) perSite.set(s.slug, { examined: 0, emitted: 0 });

    const rows = ((data ?? []) as IdeaRow[]);
    for (const r of rows) {
      const site_slug = findSiteSlug(ctx, r.site_id);
      if (site_slug) {
        const b = perSite.get(site_slug)!;
        b.examined += 1;
      }
      if ((r.hold_reasons?.length ?? 0) > 0) continue;
      if (r.decision && r.decision === 'skip') continue;
      const score = r.score ?? 0;
      const impact     = clamp(40 + score * 0.5);
      const confidence = clamp(50 + score * 0.3);
      const urgency    = r.autopilot_state === 'queued' ? 55 : 40;
      const effort     = r.decision === 'refresh' ? 25 : 55;
      outputs.push({
        source_type: 'content',
        source_id: r.id,
        source_key: `content:high_value_opportunity:${site_slug ?? 'network'}:${r.id}`,
        site_id: r.site_id,
        site_slug,
        category: 'content',
        type: 'high_value_opportunity',
        signal_kind: 'opportunity',
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
      if (site_slug) perSite.get(site_slug)!.emitted += 1;
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const b = perSite.get(site.slug)!;
      const d: RuleScopeDiagnostic = {
        scope: site.slug,
        status: b.emitted > 0 ? 'signals_found'
             : b.examined > 0 ? 'no_signal'
             : 'no_data',
        rows_examined: b.examined,
        items_emitted: b.emitted,
      };
      if (b.examined === 0) d.reason = 'no content_ideas with score ≥ 60 for this site';
      else if (b.emitted === 0) d.reason = 'all eligible ideas have holds or decision=skip';
      diags.push(d);
    }
    return { outputs, diagnostics: diags };
  },
};

const DB_PUB_TARGETS = new Set(['ygo_db', 'onepiece_db', 'lorcana_db']);

interface ArticleRow {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  status: string;
  published_at: string | null;
  publication_target: string;
  network_sites: { slug: string; canonical_url: string } | null;
}
interface GscUrlRow {
  site_id: string;
  date: string;
  page: string;
  clicks: number;
  impressions: number;
  position_avg: number | null;
}

export const contentPerformanceRule: IntelligenceRule = {
  id: 'content.existing_performance',
  description: 'Published autopilot articles close to the first page or declining materially. Only runs on sites with the DB-target convention.',
  categoriesScanned: ['content'],
  async run(ctx: RuleContext): Promise<RuleRunResult> {
    const dayMs = 24 * 60 * 60 * 1000;
    const now   = new Date(ctx.runAt);
    const endA  = new Date(now.getTime() - 1 * dayMs);
    const startA= new Date(endA.getTime() - 28 * dayMs);
    const endB  = new Date(startA.getTime() - 1 * dayMs);
    const startB= new Date(endB.getTime() - 28 * dayMs);
    const sinceA = startA.toISOString().slice(0, 10);
    const untilA = endA.toISOString().slice(0, 10);
    const sinceB = startB.toISOString().slice(0, 10);
    const untilB = endB.toISOString().slice(0, 10);

    const { data: arts } = await ctx.sb
      .from('network_articles')
      .select('id, site_id, slug, title, status, published_at, publication_target, network_sites(slug, canonical_url)')
      .eq('status', 'published')
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(300);
    const articles = ((arts ?? []) as unknown as ArticleRow[]).filter((a) => DB_PUB_TARGETS.has(a.publication_target));

    const outputs: RuleOutput[] = [];
    const perSite = new Map<SiteSlug, { examined: number; emitted: number; status: 'skipped' | 'ok' }>();
    for (const s of ctx.sites) {
      perSite.set(s.slug, {
        examined: 0, emitted: 0,
        status: ['ygo', 'onepiece', 'lorcana'].includes(s.slug) ? 'ok' : 'skipped',
      });
    }

    if (articles.length > 0) {
      const urls = articles.map((a) => {
        const base = (a.network_sites?.canonical_url ?? '').replace(/\/$/, '');
        return `${base}/insights/${a.slug}`;
      });
      const siteIds = Array.from(new Set(articles.map((a) => a.site_id)));

      const { data: gscRows } = await ctx.sb
        .from('network_gsc_url_daily')
        .select('site_id, date, page, clicks, impressions, position_avg')
        .in('site_id', siteIds)
        .in('page', urls)
        .gte('date', sinceB)
        .lte('date', untilA)
        .limit(50000);
      const gsc = ((gscRows ?? []) as GscUrlRow[]);

      interface Agg { clicksA: number; impressionsA: number; posSumA: number; posDenA: number; clicksB: number; impressionsB: number }
      const aggByUrl = new Map<string, Agg>();
      for (const r of gsc) {
        const key = `${r.site_id}|${r.page}`;
        const a = aggByUrl.get(key) ?? { clicksA: 0, impressionsA: 0, posSumA: 0, posDenA: 0, clicksB: 0, impressionsB: 0 };
        const d = new Date(r.date).getTime();
        const inA = d >= startA.getTime() && d <= endA.getTime();
        const inB = d >= startB.getTime() && d <= endB.getTime();
        if (inA) {
          a.clicksA += r.clicks; a.impressionsA += r.impressions;
          if (r.position_avg != null && r.position_avg > 0) { a.posSumA += r.impressions * r.position_avg; a.posDenA += r.impressions; }
        }
        if (inB) { a.clicksB += r.clicks; a.impressionsB += r.impressions; }
        aggByUrl.set(key, a);
      }

      for (const art of articles) {
        const site_slug = findSiteSlug(ctx, art.site_id);
        if (site_slug) perSite.get(site_slug)!.examined += 1;
        const base = (art.network_sites?.canonical_url ?? '').replace(/\/$/, '');
        const url  = `${base}/insights/${art.slug}`;
        const agg  = aggByUrl.get(`${art.site_id}|${url}`);
        if (!agg || agg.impressionsA < 100) continue;
        const avgPos = agg.posDenA > 0 ? agg.posSumA / agg.posDenA : 0;
        const ctr    = agg.impressionsA > 0 ? agg.clicksA / agg.impressionsA : 0;

        if (avgPos >= 4 && avgPos <= 15 && agg.impressionsA >= 200) {
          const targetCtr = 0.04;
          const uplift = Math.max(0, Math.round((targetCtr - ctr) * agg.impressionsA));
          outputs.push({
            source_type: 'content',
            source_id: art.id,
            source_key: `content:article_striking_distance:${site_slug ?? art.site_id}:${art.slug}`,
            site_id: art.site_id,
            site_slug,
            category: 'content',
            type: 'article_striking_distance',
            signal_kind: 'opportunity',
            title: `Article in striking distance · ${site_slug ?? 'network'} · pos ${avgPos.toFixed(1)}`,
            summary: `"${trim(art.title, 70)}" · ${agg.impressionsA.toLocaleString()} impr, CTR ${(ctr * 100).toFixed(2)}%, avg pos ${avgPos.toFixed(1)} (28d).`,
            recommended_action: 'Tighten title + meta for the primary query, strengthen on-page section anchors, add internal link reinforcement.',
            evidence: {
              article_id: art.id,
              url,
              impressions_28d: agg.impressionsA,
              clicks_28d: agg.clicksA,
              ctr,
              avg_position: avgPos,
              window: { from: sinceA, to: untilA },
            },
            impact:     clamp(25 + 20 * Math.log10(Math.max(1, agg.impressionsA / 100))),
            confidence: clamp(45 + 15 * Math.log10(Math.max(1, agg.impressionsA / 100))),
            urgency:    clamp(70 - Math.abs(avgPos - 8) * 5),
            effort:     25,
            expected_upside: uplift >= 5 ? {
              label: `+${Math.round(uplift * 0.6)} to +${uplift} clicks/month`,
              metric: 'clicks_per_month',
              low:  Math.round(uplift * 0.6),
              high: uplift,
              rationale: `Raising CTR from ${(ctr * 100).toFixed(2)}% to ~${(targetCtr * 100).toFixed(0)}%.`,
            } : null,
          });
          if (site_slug) perSite.get(site_slug)!.emitted += 1;
        }

        if (agg.clicksB >= 15 && agg.clicksA / agg.clicksB <= 0.7) {
          const changePct = ((agg.clicksA - agg.clicksB) / agg.clicksB) * 100;
          outputs.push({
            source_type: 'content',
            source_id: art.id,
            source_key: `content:article_declining:${site_slug ?? art.site_id}:${art.slug}`,
            site_id: art.site_id,
            site_slug,
            category: 'content',
            type: 'article_declining',
            signal_kind: 'risk',
            title: `Article declining · ${site_slug ?? 'network'} (${changePct.toFixed(0)}%)`,
            summary: `"${trim(art.title, 70)}" · clicks fell from ${agg.clicksB} to ${agg.clicksA} vs prior 28d.`,
            recommended_action: 'Refresh content, update dates/figures, re-inspect in GSC, check for lost ranking queries.',
            evidence: {
              article_id: art.id,
              url,
              clicks_28d: agg.clicksA,
              clicks_prior_28d: agg.clicksB,
              change_pct: changePct,
              impressions_28d: agg.impressionsA,
              window_recent: { from: sinceA, to: untilA },
              window_prior:  { from: sinceB, to: untilB },
            },
            impact:     clamp(30 + Math.min(50, Math.abs(changePct) * 0.5)),
            confidence: clamp(50 + 10 * Math.log10(Math.max(1, agg.clicksB / 10))),
            urgency:    clamp(50 + Math.abs(changePct) * 0.3),
            effort:     45,
            expected_upside: {
              label: `recover ~${Math.round(agg.clicksB - agg.clicksA)} lost clicks/28d`,
              metric: 'clicks_per_month',
              low:  Math.round((agg.clicksB - agg.clicksA) * 0.5),
              high: Math.round(agg.clicksB - agg.clicksA),
              rationale: 'Full recovery would restore prior-period click volume.',
            },
          });
          if (site_slug) perSite.get(site_slug)!.emitted += 1;
        }
      }
    }

    const diags: RuleScopeDiagnostic[] = [];
    for (const site of ctx.sites) {
      const b = perSite.get(site.slug)!;
      const d: RuleScopeDiagnostic = { scope: site.slug, status: 'no_data', items_emitted: b.emitted, rows_examined: b.examined };
      if (b.status === 'skipped') { d.status = 'skipped'; d.reason = 'site lacks DB-target publication convention'; }
      else if (b.emitted > 0) d.status = 'signals_found';
      else if (b.examined > 0) { d.status = 'no_signal'; d.reason = 'articles examined but none crossed striking/declining gates'; }
      else d.reason = 'no published articles yet for this DB-target site';
      diags.push(d);
    }
    return { outputs, diagnostics: diags };
  },
};

function clamp(v: number): number { return Math.max(0, Math.min(100, Math.round(v))); }
function trim(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function findSiteSlug(ctx: RuleContext, site_id: string): SiteSlug | null {
  for (const s of ctx.sites) if (s.id === site_id) return s.slug;
  return null;
}
