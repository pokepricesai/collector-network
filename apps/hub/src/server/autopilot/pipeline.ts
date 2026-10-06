import 'server-only';

// End-to-end Autopilot pipeline orchestrator (preview / dry-run).
//
// Steps:
//   1. Load the admin autopilot config.
//   2. Pick the top-scored opportunity for the pilot site (YGO).
//   3. Build the deterministic evidence pack (persist is OPT-IN).
//   4. Evaluate evidence quality — HELD paths exit early.
//   5. Estimate cost. If estimate exceeds caps, HELD.
//   6. Run the executor in FIXTURE mode (REAL is not permitted here).
//   7. Convert the draft to body_rich.
//   8. Run deterministic QA, apply safe auto-repairs.
//   9. Compose a PipelineResult.
//  10. NO publishing. NO budget reservation. NO AI spend.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutopilotSiteSlug } from './config';
import type {
  ArticleTemplateId,
  EvidenceQualityVerdict,
  PipelineResult,
  ScoredOpportunity,
} from './types';
import { loadAutopilotSnapshot } from './config';
import { buildScoredOpportunity } from './opportunity-scoring';
import { buildEvidencePack, evaluateEvidenceQuality } from './evidence-pack';
import { estimateCost } from './cost-estimator';
import { executeDraft } from './executor';
import { runDeterministicQA } from './qa';
import { draftToBodyRich, type TiptapDoc } from './body-rich';

export interface PreviewParams {
  sb: SupabaseClient;
  site_slug: AutopilotSiteSlug;
}

export interface PreviewResult {
  pipeline: PipelineResult;
  body_rich: TiptapDoc | null;
  evidence_quality: EvidenceQualityVerdict;
  stop_reason: string | null;         // null when the pipeline completed through fixture draft + QA
}

const CHECKPOINT_B_MODE = 'fixture' as const;

export async function previewPipeline(params: PreviewParams): Promise<PreviewResult> {
  const snap = await loadAutopilotSnapshot(params.sb);

  // ─── 1. Resolve the pilot site ───────────────────────────────
  const { data: siteRow, error: siteErr } = await params.sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('slug', params.site_slug)
    .maybeSingle();
  if (siteErr || !siteRow) {
    return emptyPreview('Pilot site not found in network_sites.', snap.global.max_cost_per_article_usd);
  }
  const site = siteRow as { id: string; slug: string; name: string };

  // ─── 2. Pick a candidate opportunity ─────────────────────────
  // We don't score every idea in Checkpoint B — we score the single
  // top-priority idea for the pilot site. In Checkpoint C the
  // orchestrator will iterate the full queue.
  const { data: ideaRows } = await params.sb
    .from('network_content_ideas')
    .select('id, working_title, primary_query, secondary_queries, summary, content_type, status, created_at, origin_type')
    .eq('site_id', site.id)
    .in('status', ['new', 'in_brief'])
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  const idea = (ideaRows ?? [])[0] as
    | { id: string; working_title: string; primary_query: string | null; secondary_queries: string[]; summary: string | null; content_type: string; created_at: string; origin_type: string }
    | undefined;

  if (!idea) {
    return emptyPreview('No pending idea for the pilot site. Create one via /admin/content/ideas (or let the opportunity engine populate the queue).', snap.global.max_cost_per_article_usd);
  }

  // Pick template. Default to evergreen_guide when YGO has no pricing
  // yet (the audit confirmed pricing is in a separate project). The
  // orchestrator in Checkpoint C will choose template per opportunity
  // signal.
  const template_id: ArticleTemplateId =
    (idea.content_type as ArticleTemplateId) === 'market_movers' ? 'market_movers' :
    (idea.content_type as ArticleTemplateId) === 'set_guide'     ? 'set_guide' :
    (idea.content_type as ArticleTemplateId) === 'card_guide'    ? 'card_guide' :
    (idea.content_type as ArticleTemplateId) === 'refresh'       ? 'refresh' :
    'evergreen_guide';

  // Signal collection for scoring. We make small direct queries so
  // the scorer has real numbers rather than guesses.
  const signals = await collectSignals(params.sb, site.id, idea.working_title, idea.primary_query);

  const existingForRouting = await params.sb
    .from('network_articles')
    .select('id, slug, title, published_at, publication_url')
    .eq('site_id', site.id)
    .in('status', ['published', 'approved', 'scheduled', 'review']);
  const existing = ((existingForRouting.data ?? []) as Array<{ id: string; slug: string; title: string; published_at: string | null; publication_url: string | null }>)
    .map((r) => ({
      article_id: r.id,
      url: r.publication_url ?? `https://ygoprices.io/insights/${r.slug}`,
      overlap: lexicalOverlap(idea.working_title, r.title),
      age_days: r.published_at ? Math.max(0, Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86_400_000)) : null,
    }));

  const opportunity: ScoredOpportunity = buildScoredOpportunity(
    { idea_id: idea.id, site_slug: params.site_slug, working_title: idea.working_title, template_id, signals },
    existing,
  );

  // Score below threshold ⇒ skip.
  const budget_preview_base = {
    projected_cost_usd: 0,
    per_article_cap_usd: snap.global.max_cost_per_article_usd,
    daily_remaining_usd: 0,
    monthly_remaining_usd: 0,
  };
  if (opportunity.score.total < snap.global.min_opportunity_score) {
    return {
      pipeline: {
        mode: CHECKPOINT_B_MODE,
        outcome: 'held',
        hold_reasons: ['below_min_score'],
        opportunity,
        evidence_pack_id: null,
        evidence_pack: synthEmptyPack(idea.working_title, params.site_slug, site.name, template_id, snap.global.max_cost_per_article_usd),
        draft: null,
        qa: null,
        budget_preview: budget_preview_base,
      },
      body_rich: null,
      evidence_quality: { status: 'held', hold_reasons: ['below_min_score'], warnings: [] },
      stop_reason: `Opportunity score ${opportunity.score.total} is below min_opportunity_score ${snap.global.min_opportunity_score}.`,
    };
  }

  // ─── 3. Build evidence pack ───────────────────────────────────
  const packBuilt = await buildEvidencePack(params.sb, {
    site_slug: params.site_slug,
    site_name: site.name,
    site_id: site.id,
    template_id,
    working_title: idea.working_title,
    primary_query: idea.primary_query,
    secondary_queries: idea.secondary_queries ?? [],
    summary: idea.summary,
    date_range_days: 30,
    budget: {
      max_cost_usd: snap.global.max_cost_per_article_usd,
      projected_draft_cost_usd: 0,  // filled in after estimateCost below
      projected_qa_cost_usd: null,
    },
  });

  // ─── 4. Evidence quality ─────────────────────────────────────
  const quality = evaluateEvidenceQuality(packBuilt.payload);

  // ─── 5. Cost estimate ────────────────────────────────────────
  const costEst = await estimateCost(params.sb, packBuilt.payload, { include_qa: false });

  // Re-stamp the pack with the real projected costs so downstream
  // consumers see one coherent object.
  packBuilt.payload.budget = {
    max_cost_usd: snap.global.max_cost_per_article_usd,
    projected_draft_cost_usd: costEst.projected_draft_usd,
    projected_qa_cost_usd: costEst.qa_model ? costEst.projected_qa_usd : null,
    projected_total_cost_usd: costEst.projected_total_usd,
  };

  if (quality.status === 'held') {
    return {
      pipeline: {
        mode: CHECKPOINT_B_MODE,
        outcome: 'held',
        hold_reasons: quality.hold_reasons,
        opportunity,
        evidence_pack_id: null,
        evidence_pack: packBuilt.payload,
        draft: null,
        qa: null,
        budget_preview: {
          projected_cost_usd: costEst.projected_total_usd,
          per_article_cap_usd: costEst.per_article_cap_usd,
          daily_remaining_usd: costEst.daily_remaining_usd,
          monthly_remaining_usd: costEst.monthly_remaining_usd,
        },
      },
      body_rich: null,
      evidence_quality: quality,
      stop_reason: `Evidence quality: held. Reasons: ${quality.hold_reasons.join(', ')}.`,
    };
  }

  // ─── 6. Fixture execution ────────────────────────────────────
  const exec = await executeDraft(params.sb, { mode: CHECKPOINT_B_MODE, pack: packBuilt.payload });

  // ─── 7. body_rich conversion ─────────────────────────────────
  const bodyRich = draftToBodyRich(exec.draft);

  // ─── 8. Deterministic QA ─────────────────────────────────────
  const { report, repaired } = await runDeterministicQA({
    sb: params.sb,
    pack: packBuilt.payload,
    draft: exec.draft,
    site_id: site.id,
  });

  // Compose outcome. In Checkpoint B we never publish and never
  // reserve budget — the terminal state is "ready_for_first_paid_run"
  // when deterministic QA has no blockers, otherwise "held".
  const outcome: PipelineResult['outcome'] =
    report.blocker_count > 0 ? 'held' : 'ready_for_first_paid_run';
  const hold_reasons: string[] = [];
  if (report.blocker_count > 0) {
    for (const f of report.findings) {
      if (f.severity === 'blocker') {
        if (f.check_name === 'slug_unique') hold_reasons.push('title_cannibalisation');
        else if (f.check_name === 'title_cannibalisation') hold_reasons.push('title_cannibalisation');
        else if (f.check_name === 'price_claim_traceable') hold_reasons.push('price_claim_failed');
        else if (f.check_name === 'percentage_claim_traceable') hold_reasons.push('price_claim_failed');
        else if (f.check_name === 'image_resolves') hold_reasons.push('image_missing');
        else if (f.check_name === 'banned_filler_phrase') hold_reasons.push('semantic_qa_failed');
        else if (f.check_name === 'body_rich_sanitised') hold_reasons.push('semantic_qa_failed');
      }
    }
  }
  if (!costEst.fits) hold_reasons.push(...costEst.blockers);

  return {
    pipeline: {
      mode: CHECKPOINT_B_MODE,
      outcome: hold_reasons.length > 0 ? 'held' : outcome,
      hold_reasons: Array.from(new Set(hold_reasons)),
      opportunity,
      evidence_pack_id: null,
      evidence_pack: packBuilt.payload,
      draft: repaired,
      qa: report,
      budget_preview: {
        projected_cost_usd: costEst.projected_total_usd,
        per_article_cap_usd: costEst.per_article_cap_usd,
        daily_remaining_usd: costEst.daily_remaining_usd,
        monthly_remaining_usd: costEst.monthly_remaining_usd,
      },
    },
    body_rich: bodyRich,
    evidence_quality: quality,
    stop_reason: hold_reasons.length > 0
      ? `Pipeline held. Reasons: ${hold_reasons.join(', ')}.`
      : null,
  };
}

async function collectSignals(sb: SupabaseClient, siteId: string, title: string, primaryQuery: string | null) {
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  // Impressions aggregation for the primary query, if present. Otherwise 0.
  let imp = 0, clicks = 0, striking = 0;
  if (primaryQuery) {
    const { data } = await sb
      .from('network_gsc_query_daily')
      .select('impressions, clicks, position_avg')
      .eq('site_id', siteId)
      .eq('query', primaryQuery)
      .gte('date', since)
      .limit(1000);
    const rows = (data ?? []) as Array<{ impressions: number; clicks: number; position_avg: number }>;
    for (const r of rows) {
      imp += r.impressions ?? 0;
      clicks += r.clicks ?? 0;
      if ((r.position_avg ?? 0) >= 4 && (r.position_avg ?? 0) <= 20 && (r.impressions ?? 0) > 0) striking += 1;
    }
  }

  const { data: imgRows } = await sb.from('tcg_cards').select('id', { count: 'exact', head: true }).eq('game_id', 'ygo').not('images', 'is', null).limit(1);
  const imagesAvailable = Array.isArray(imgRows) ? imgRows.length : 1;

  const { data: existingArticles } = await sb
    .from('network_articles')
    .select('title')
    .eq('site_id', siteId)
    .eq('status', 'published');
  let similar = 0;
  let closest = 0;
  for (const row of (existingArticles ?? []) as Array<{ title: string }>) {
    const overlap = lexicalOverlap(title, row.title);
    if (overlap > closest) closest = overlap;
    if (overlap > 0.3) similar += 1;
  }

  return {
    search_impressions_28d: imp,
    search_clicks_28d: clicks,
    search_position_avg: null,
    search_striking_distance_count: striking,
    market_observations: 0,                 // YGO pricing not mirrored yet
    market_max_abs_percentage_change: 0,
    signal_age_days: 1,                     // ideas are freshly surfaced in the queue
    images_available: imagesAvailable,
    internal_link_candidates: 0,
    related_pages: Math.min(20, (existingArticles ?? []).length),
    affiliate_links_available: 5,
    existing_similar_articles: similar,
    closest_existing_overlap: closest,
    closest_existing_age_days: null,
    template_complexity: 'low' as const,
  };
}

function lexicalOverlap(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter += 1;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : inter / union;
}

function emptyPreview(reason: string, cap: number): PreviewResult {
  const stub: PipelineResult = {
    mode: CHECKPOINT_B_MODE,
    outcome: 'held',
    hold_reasons: ['evidence_insufficient'],
    opportunity: {
      idea_id: '',
      site_slug: 'ygo',
      working_title: '(none)',
      template_id: 'evergreen_guide',
      score: { total: 0, components: {
        search_potential: 0, market_significance: 0, timeliness: 0, evidence_quality: 0,
        commercial_relevance: 0, internal_link_opportunity: 0, existing_content_gap: 0,
        duplication_penalty: 0, effort_adjustment: 0,
      }, rationale: [reason] },
      routing: { decision: 'skip', reason, target_article_id: null, target_url: null },
      evidence_summary: { market_observations: 0, search_observations: 0, related_pages: 0, images_available: 0, internal_link_candidates: 0, existing_similar_articles: 0 },
    },
    evidence_pack_id: null,
    evidence_pack: synthEmptyPack('(none)', 'ygo', 'YGOPrices', 'evergreen_guide', cap),
    draft: null,
    qa: null,
    budget_preview: {
      projected_cost_usd: 0,
      per_article_cap_usd: cap,
      daily_remaining_usd: 0,
      monthly_remaining_usd: 0,
    },
  };
  return { pipeline: stub, body_rich: null, evidence_quality: { status: 'held', hold_reasons: ['evidence_insufficient'], warnings: [] }, stop_reason: reason };
}

function synthEmptyPack(title: string, slug: AutopilotSiteSlug, siteName: string, template: ArticleTemplateId, cap: number) {
  return {
    schema_version: '1' as const,
    site: { slug, name: siteName },
    topic: { kind: template, working_title: title, primary_query: null, secondary_queries: [], summary: null },
    date_range: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    methodology: 'No evidence pack built — no candidate opportunity.',
    market_data: [],
    search_data: [],
    related_pages: [],
    internal_links: [],
    existing_content: [],
    images: [],
    commercial_links: [],
    generation_constraints: { template_id: template, max_output_tokens: 4000, target_word_count_min: 300, target_word_count_max: 700, banned_phrases: [] },
    budget: { max_cost_usd: cap, projected_draft_cost_usd: 0, projected_qa_cost_usd: null, projected_total_cost_usd: 0 },
  };
}
