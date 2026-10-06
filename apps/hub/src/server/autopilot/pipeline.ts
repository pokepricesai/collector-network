import 'server-only';

// Unified Autopilot pipeline orchestrator (preview / dry-run).
//
// Checkpoint B.1 unifies internal content ideas and externally
// discovered signals into one candidate pool. The scorer picks the
// best candidate; the evidence pack builder is handed the signals
// for the chosen topic so the research pack carries real external
// sources. No AI call, no publishing, no budget reservation.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutopilotSiteSlug } from './config';
import type {
  ArticleTemplateId,
  DiscoveredSignal,
  EvidenceQualityVerdict,
  PipelineResult,
  ScoredOpportunity,
  SourceTier,
} from './types';
import { loadAutopilotSnapshot } from './config';
import { buildScoredOpportunity, type ScoringSignals } from './opportunity-scoring';
import { buildEvidencePack, evaluateEvidenceQuality } from './evidence-pack';
import { estimateCost } from './cost-estimator';
import { executeDraft } from './executor';
import { runDeterministicQA } from './qa';
import { draftToBodyRich, type TiptapDoc } from './body-rich';
import { runDiscovery, loadActiveSignals } from './discovery';
import { buildInternalLinks } from './internal-links';
import { assemblePrompt, loadVoiceSnapshot, type AssembledPrompt } from './prompt';
import { extractSignalsForPack, type ExtractionResult } from './external-extraction';

export interface PreviewParams {
  sb: SupabaseClient;
  site_slug: AutopilotSiteSlug;
  force_discovery?: boolean;
}

export interface CandidateSummary {
  kind: 'internal_idea' | 'external_cluster';
  key: string;                            // idea_id or cluster_key
  working_title: string;
  template_id: ArticleTemplateId;
  score: number;
  score_rationale: string[];
  supporting_signal_ids: string[];        // external only
  supporting_source_tiers: SourceTier[];  // external only
  decision: ScoredOpportunity['routing']['decision'];
}

export interface PreviewResult {
  pipeline: PipelineResult;
  body_rich: TiptapDoc | null;
  evidence_quality: EvidenceQualityVerdict;
  stop_reason: string | null;
  // Visibility: all candidates considered, so the admin can see WHY
  // the top one was chosen (and what the runners-up were).
  candidates: CandidateSummary[];
  discovery: {
    cached: boolean;
    cache_age_minutes: number | null;
    sources_scanned: number;
    signals_found: number;
    signals_inserted: number;
    errors: Array<{ source_id: string; source_name: string; message: string }>;
    total_active_signals: number;
    enabled_sources: number;
  };
  internal_links: {
    outbound_count: number;
    inbound_opportunity_count: number;
    validation: Array<{ url: string; status: 'ok' | 'warning'; message: string }>;
    outbound: Array<{ target_url: string; anchor_concepts: string[]; reason: string; priority: number }>;
  };
  prompt: AssembledPrompt | null;
  extraction: ExtractionResult[];
}

const CHECKPOINT_B_MODE = 'fixture' as const;

export async function previewPipeline(params: PreviewParams): Promise<PreviewResult> {
  const snap = await loadAutopilotSnapshot(params.sb);

  // ─── Resolve pilot site ──────────────────────────────────────
  const { data: siteRow, error: siteErr } = await params.sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('slug', params.site_slug)
    .maybeSingle();
  if (siteErr || !siteRow) {
    const stub = emptyPreview('Pilot site not found in network_sites.', snap.global.max_cost_per_article_usd);
    return {
      pipeline: stub.pipeline,
      body_rich: stub.body_rich,
      evidence_quality: stub.evidence_quality,
      stop_reason: stub.stop_reason,
      candidates: [],
      discovery: { cached: false, cache_age_minutes: null, sources_scanned: 0, signals_found: 0, signals_inserted: 0, errors: [], total_active_signals: 0, enabled_sources: 0 },
      internal_links: { outbound_count: 0, inbound_opportunity_count: 0, validation: [], outbound: [] },
      prompt: null,
      extraction: [],
    };
  }
  const site = siteRow as { id: string; slug: string; name: string };

  // ─── Discovery (cached) ──────────────────────────────────────
  const discovery = await runDiscovery(params.sb, params.site_slug, { force: params.force_discovery, maxAgeMinutes: 60 });
  const signals = await loadActiveSignals(params.sb, params.site_slug, 50);
  const { count: enabledSourcesCount } = await params.sb
    .from('network_autopilot_sources')
    .select('*', { count: 'exact', head: true })
    .eq('site_slug', params.site_slug)
    .eq('enabled', true);
  const enabledSources = enabledSourcesCount ?? 0;

  // ─── Internal candidates ─────────────────────────────────────
  const { data: ideaRows } = await params.sb
    .from('network_content_ideas')
    .select('id, working_title, primary_query, secondary_queries, summary, content_type, status, created_at, origin_type')
    .eq('site_id', site.id)
    .in('status', ['new', 'in_brief'])
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);
  const internalCandidates = (ideaRows ?? []) as Array<{
    id: string; working_title: string; primary_query: string | null; secondary_queries: string[];
    summary: string | null; content_type: string; created_at: string; origin_type: string;
  }>;

  // ─── Existing article corpus (for duplication / routing) ─────
  const existingForRouting = await params.sb
    .from('network_articles')
    .select('id, slug, title, published_at, publication_url')
    .eq('site_id', site.id)
    .in('status', ['published', 'approved', 'scheduled', 'review']);
  const existingArticles = ((existingForRouting.data ?? []) as Array<{ id: string; slug: string; title: string; published_at: string | null; publication_url: string | null }>);

  // ─── Build a cluster-level view of external signals ──────────
  // Group signals by cluster_key (or by url when cluster_key is null).
  const clusters = new Map<string, DiscoveredSignal[]>();
  for (const s of signals) {
    const key = s.cluster_key ?? `url:${s.url}`;
    const bucket = clusters.get(key) ?? [];
    bucket.push(s);
    clusters.set(key, bucket);
  }

  // ─── Score candidates ────────────────────────────────────────
  const scoredInternal = internalCandidates.map((idea) => {
    const template_id = toTemplate(idea.content_type);
    const scoringSignals = buildInternalSignals(idea.working_title, 0, existingArticles.length);
    const existing = existingArticles.map((r) => ({
      article_id: r.id,
      url: r.publication_url ?? `https://ygoprices.io/insights/${r.slug}`,
      overlap: lexicalOverlap(idea.working_title, r.title),
      age_days: r.published_at ? Math.max(0, Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86_400_000)) : null,
    }));
    const opp = buildScoredOpportunity(
      { idea_id: idea.id, site_slug: params.site_slug, working_title: idea.working_title, template_id, signals: scoringSignals },
      existing,
    );
    return { kind: 'internal_idea' as const, key: idea.id, opp, idea, signals_for_pack: [] as DiscoveredSignal[] };
  });

  const scoredExternal = Array.from(clusters.entries()).map(([clusterKey, clusterSignals]) => {
    const title = clusterSignals[0]!.title;
    // Choose template based on dominant tier: news for official/secondary, trend_story for community-only.
    const hasAuth = clusterSignals.some((s) => s.source_tier !== 'community');
    const template_id: ArticleTemplateId = hasAuth ? 'news' : 'trend_story';
    const scoringSignals: ScoringSignals = {
      search_impressions_28d: 0,
      search_clicks_28d: 0,
      search_position_avg: null,
      search_striking_distance_count: 0,
      market_observations: 0,
      market_max_abs_percentage_change: 0,
      signal_age_days: clusterSignals[0]!.published_at
        ? Math.max(0, Math.floor((Date.now() - new Date(clusterSignals[0]!.published_at!).getTime()) / 86_400_000))
        : 7,
      images_available: 1,  // we assume at least a card image is available via internal catalogue
      internal_link_candidates: 0,
      related_pages: existingArticles.length,
      affiliate_links_available: 3,
      existing_similar_articles: existingArticles.filter((e) => lexicalOverlap(title, e.title) > 0.3).length,
      closest_existing_overlap: existingArticles.reduce((m, e) => Math.max(m, lexicalOverlap(title, e.title)), 0),
      closest_existing_age_days: null,
      template_complexity: 'medium',
      external_source_count: clusterSignals.length,
      external_official_count: clusterSignals.filter((s) => s.source_tier === 'official').length,
      external_secondary_count: clusterSignals.filter((s) => s.source_tier === 'secondary').length,
      external_community_count: clusterSignals.filter((s) => s.source_tier === 'community').length,
      external_distinct_domains: new Set(clusterSignals.map((s) => s.domain)).size,
      external_newest_age_days: scoringSignals_newest(clusterSignals),
    };
    const existing = existingArticles.map((r) => ({
      article_id: r.id,
      url: r.publication_url ?? `https://ygoprices.io/insights/${r.slug}`,
      overlap: lexicalOverlap(title, r.title),
      age_days: r.published_at ? Math.max(0, Math.floor((Date.now() - new Date(r.published_at).getTime()) / 86_400_000)) : null,
    }));
    const opp = buildScoredOpportunity(
      { idea_id: `ext:${clusterKey}`, site_slug: params.site_slug, working_title: title, template_id, signals: scoringSignals },
      existing,
    );
    return { kind: 'external_cluster' as const, key: clusterKey, opp, signals_for_pack: clusterSignals };
  });

  const allScored = [...scoredInternal, ...scoredExternal].sort((a, b) => b.opp.score.total - a.opp.score.total);
  const chosen = allScored[0] ?? null;

  // Build the full candidate summary list for the preview UI.
  const candidates: CandidateSummary[] = allScored.map((c) => ({
    kind: c.kind,
    key: c.key,
    working_title: c.opp.working_title,
    template_id: c.opp.template_id,
    score: c.opp.score.total,
    score_rationale: c.opp.score.rationale,
    supporting_signal_ids: c.kind === 'external_cluster' ? c.signals_for_pack.map((s) => s.id).filter(Boolean) as string[] : [],
    supporting_source_tiers: c.kind === 'external_cluster' ? c.signals_for_pack.map((s) => s.source_tier) : [],
    decision: c.opp.routing.decision,
  }));

  const budget_preview_base = {
    projected_cost_usd: 0,
    per_article_cap_usd: snap.global.max_cost_per_article_usd,
    daily_remaining_usd: 0,
    monthly_remaining_usd: 0,
  };

  if (!chosen) {
    const stub = emptyPreview('No internal ideas or external signals available for this site. Enable sources at /admin/content/autopilot/sources OR create an idea at /admin/content/ideas.', snap.global.max_cost_per_article_usd);
    return {
      pipeline: stub.pipeline,
      body_rich: stub.body_rich,
      evidence_quality: stub.evidence_quality,
      stop_reason: stub.stop_reason,
      candidates: [],
      discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
      internal_links: { outbound_count: 0, inbound_opportunity_count: 0, validation: [], outbound: [] },
      prompt: null,
      extraction: [],
    };
  }

  if (chosen.opp.score.total < snap.global.min_opportunity_score) {
    return {
      pipeline: {
        mode: CHECKPOINT_B_MODE,
        outcome: 'held',
        hold_reasons: ['below_min_score'],
        opportunity: chosen.opp,
        evidence_pack_id: null,
        evidence_pack: synthEmptyPack(chosen.opp.working_title, params.site_slug, site.name, chosen.opp.template_id, snap.global.max_cost_per_article_usd),
        draft: null,
        qa: null,
        budget_preview: budget_preview_base,
      },
      body_rich: null,
      evidence_quality: { status: 'held', hold_reasons: ['below_min_score'], warnings: [] },
      stop_reason: `Top candidate score ${chosen.opp.score.total} is below min_opportunity_score ${snap.global.min_opportunity_score}.`,
      candidates,
      discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
      internal_links: { outbound_count: 0, inbound_opportunity_count: 0, validation: [], outbound: [] },
      prompt: null,
      extraction: [],
    };
  }

  // ─── Internal link engine ────────────────────────────────────
  const linkEngine = await buildInternalLinks({
    sb: params.sb,
    site_slug: params.site_slug,
    site_id: site.id,
    working_title: chosen.opp.working_title,
    primary_query: chosen.kind === 'internal_idea' ? ((chosen as { idea?: { primary_query: string | null } }).idea?.primary_query ?? null) : null,
    candidate_url: null,
  });

  // ─── External extraction for the top signals of the chosen candidate ─
  const extractionResults = chosen.kind === 'external_cluster'
    ? await extractSignalsForPack(params.sb, chosen.signals_for_pack, params.site_slug, 3)
    : [] as ExtractionResult[];
  const extractedByUrl = new Map<string, { extracted_text: string; og_image_url: string | null; published_at: string | null }>();
  for (const e of extractionResults) {
    if (e.success && e.extracted_text) {
      extractedByUrl.set(e.url, {
        extracted_text: e.extracted_text,
        og_image_url: e.og_image_url ?? null,
        published_at: e.published_at ?? null,
      });
    }
  }

  // ─── Build evidence pack ─────────────────────────────────────
  const packIdeaId = chosen.kind === 'internal_idea' ? chosen.key : null;
  const packBuilt = await buildEvidencePack(params.sb, {
    site_slug: params.site_slug,
    site_name: site.name,
    site_id: site.id,
    template_id: chosen.opp.template_id,
    working_title: chosen.opp.working_title,
    primary_query: chosen.kind === 'internal_idea' ? (chosen as { idea?: { primary_query: string | null } }).idea?.primary_query ?? null : null,
    secondary_queries: chosen.kind === 'internal_idea' ? (chosen as { idea?: { secondary_queries: string[] } }).idea?.secondary_queries ?? [] : [],
    summary: chosen.kind === 'internal_idea' ? (chosen as { idea?: { summary: string | null } }).idea?.summary ?? null : chosen.signals_for_pack[0]?.summary ?? null,
    date_range_days: 30,
    external_signals: chosen.signals_for_pack,
    extracted_by_url: extractedByUrl,
    approved_internal_links: linkEngine.outbound,
    budget: {
      max_cost_usd: snap.global.max_cost_per_article_usd,
      projected_draft_cost_usd: 0,
      projected_qa_cost_usd: null,
    },
  });

  const quality = evaluateEvidenceQuality(packBuilt.payload);

  const costEst = await estimateCost(params.sb, packBuilt.payload, { include_qa: false });
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
        opportunity: chosen.opp,
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
      candidates,
      discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
      internal_links: {
        outbound_count: linkEngine.outbound.length,
        inbound_opportunity_count: linkEngine.inbound_opportunities.length,
        validation: linkEngine.validation,
        outbound: linkEngine.outbound.map((l) => ({ target_url: l.target_url, anchor_concepts: l.anchor_concepts, reason: l.reason, priority: l.priority })),
      },
      prompt: null,  // not assembled on held path
      extraction: extractionResults,
    };
  }

  // ─── Prompt assembly (deterministic, no AI call) ─────────────
  const voice = await loadVoiceSnapshot(params.sb, site.id);
  const prompt = assemblePrompt({
    pack: packBuilt.payload,
    voice,
    approved_internal_links: linkEngine.outbound,
  });

  const exec = await executeDraft(params.sb, { mode: CHECKPOINT_B_MODE, pack: packBuilt.payload });
  const bodyRich = draftToBodyRich(exec.draft);
  const { report, repaired } = await runDeterministicQA({
    sb: params.sb,
    pack: packBuilt.payload,
    draft: exec.draft,
    site_id: site.id,
  });

  const outcome: PipelineResult['outcome'] =
    report.blocker_count > 0 ? 'held' : 'ready_for_first_paid_run';
  const hold_reasons: string[] = [];
  if (report.blocker_count > 0) {
    for (const f of report.findings) {
      if (f.severity !== 'blocker') continue;
      if (f.check_name === 'slug_unique' || f.check_name === 'title_cannibalisation') hold_reasons.push('title_cannibalisation');
      else if (f.check_name === 'price_claim_traceable' || f.check_name === 'percentage_claim_traceable') hold_reasons.push('price_claim_failed');
      else if (f.check_name === 'image_resolves') hold_reasons.push('image_missing');
      else if (f.check_name === 'banned_filler_phrase' || f.check_name === 'body_rich_sanitised') hold_reasons.push('semantic_qa_failed');
    }
  }
  if (!costEst.fits) hold_reasons.push(...costEst.blockers);

  return {
    pipeline: {
      mode: CHECKPOINT_B_MODE,
      outcome: hold_reasons.length > 0 ? 'held' : outcome,
      hold_reasons: Array.from(new Set(hold_reasons)),
      opportunity: chosen.opp,
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
    stop_reason: hold_reasons.length > 0 ? `Pipeline held. Reasons: ${hold_reasons.join(', ')}.` : null,
    candidates,
    discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
    internal_links: {
      outbound_count: linkEngine.outbound.length,
      inbound_opportunity_count: linkEngine.inbound_opportunities.length,
      validation: linkEngine.validation,
      outbound: linkEngine.outbound.map((l) => ({ target_url: l.target_url, anchor_concepts: l.anchor_concepts, reason: l.reason, priority: l.priority })),
    },
    prompt,
    extraction: extractionResults,
  };
}

function toTemplate(contentType: string): ArticleTemplateId {
  switch (contentType) {
    case 'market_movers':      return 'market_movers';
    case 'set_guide':          return 'set_guide';
    case 'set_deep_dive':      return 'set_deep_dive';
    case 'card_guide':         return 'card_guide';
    case 'card_deep_dive':     return 'card_deep_dive';
    case 'archetype_guide':    return 'archetype_guide';
    case 'collector_guide':    return 'collector_guide';
    case 'evergreen_guide':    return 'evergreen_guide';
    case 'search_led':         return 'search_led';
    case 'news':               return 'news';
    case 'trend_story':        return 'trend_story';
    case 'tournament_context': return 'tournament_context';
    case 'retrospective':      return 'retrospective';
    case 'refresh':            return 'refresh';
    default:                   return 'evergreen_guide';
  }
}

function buildInternalSignals(_title: string, _market: number, existing: number): ScoringSignals {
  return {
    search_impressions_28d: 0,
    search_clicks_28d: 0,
    search_position_avg: null,
    search_striking_distance_count: 0,
    market_observations: 0,
    market_max_abs_percentage_change: 0,
    signal_age_days: 1,
    images_available: 1,
    internal_link_candidates: 0,
    related_pages: Math.min(20, existing),
    affiliate_links_available: 5,
    existing_similar_articles: 0,
    closest_existing_overlap: 0,
    closest_existing_age_days: null,
    template_complexity: 'low',
    external_source_count: 0,
    external_official_count: 0,
    external_secondary_count: 0,
    external_community_count: 0,
    external_distinct_domains: 0,
    external_newest_age_days: null,
  };
}

function scoringSignals_newest(signals: DiscoveredSignal[]): number | null {
  let newest: number | null = null;
  for (const s of signals) {
    if (!s.published_at) continue;
    const age = Math.max(0, Math.floor((Date.now() - new Date(s.published_at).getTime()) / 86_400_000));
    if (newest == null || age < newest) newest = age;
  }
  return newest;
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

function emptyPreview(reason: string, cap: number): Omit<PreviewResult, 'candidates' | 'discovery' | 'internal_links' | 'prompt' | 'extraction'> {
  const stub: PipelineResult = {
    mode: CHECKPOINT_B_MODE,
    outcome: 'held',
    hold_reasons: ['evidence_insufficient'],
    opportunity: {
      idea_id: '',
      site_slug: 'ygo',
      working_title: '(none)',
      template_id: 'evergreen_guide',
      score: { total: 0, components: emptyComponents(), rationale: [reason] },
      routing: { decision: 'skip', reason, target_article_id: null, target_url: null },
      evidence_summary: { market_observations: 0, search_observations: 0, related_pages: 0, images_available: 0, internal_link_candidates: 0, existing_similar_articles: 0 },
    },
    evidence_pack_id: null,
    evidence_pack: synthEmptyPack('(none)', 'ygo', 'YGOPrices', 'evergreen_guide', cap),
    draft: null,
    qa: null,
    budget_preview: { projected_cost_usd: 0, per_article_cap_usd: cap, daily_remaining_usd: 0, monthly_remaining_usd: 0 },
  };
  return { pipeline: stub, body_rich: null, evidence_quality: { status: 'held', hold_reasons: ['evidence_insufficient'], warnings: [] }, stop_reason: reason };
}

function emptyComponents() {
  return {
    search_potential: 0, market_significance: 0, timeliness: 0, evidence_quality: 0,
    commercial_relevance: 0, internal_link_opportunity: 0, existing_content_gap: 0,
    newsworthiness: 0, source_authority: 0,
    duplication_penalty: 0, source_agreement_penalty: 0, effort_adjustment: 0,
  };
}

function synthEmptyPack(title: string, slug: AutopilotSiteSlug, siteName: string, template: ArticleTemplateId, cap: number) {
  return {
    schema_version: '2' as const,
    site: { slug, name: siteName },
    topic: { kind: template, working_title: title, primary_query: null, secondary_queries: [], summary: null },
    date_range: { from: new Date().toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    methodology: 'No evidence pack built — no candidate.',
    market_data: [],
    search_data: [],
    related_pages: [],
    internal_links: [],
    existing_content: [],
    images: [],
    commercial_links: [],
    external_sources: [],
    article_angle: { anchor: 'explainer' as const, one_line: '', must_cover: [], must_not_cover: [], dominant_tier: 'internal' as const },
    generation_constraints: { template_id: template, max_output_tokens: 4000, target_word_count_min: 300, target_word_count_max: 700, banned_phrases: [] },
    budget: { max_cost_usd: cap, projected_draft_cost_usd: 0, projected_qa_cost_usd: null, projected_total_cost_usd: 0 },
  };
}

function discoveryToSummary(d: Awaited<ReturnType<typeof runDiscovery>>): Omit<PreviewResult['discovery'], 'total_active_signals' | 'enabled_sources'> {
  return {
    cached: d.cached,
    cache_age_minutes: d.cache_age_minutes,
    sources_scanned: d.sources_scanned,
    signals_found: d.signals_found,
    signals_inserted: d.signals_inserted,
    errors: d.errors,
  };
}

// Compute enabled_sources inline — the `head: true` form earlier
// returns the count on the result wrapper, not on `data`. We don't
// use that pattern here because the preview page can live with a
// best-effort number; a dedicated query runs separately below.
