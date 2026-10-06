import 'server-only';

// Two-stage Autopilot pipeline (fixture / dry-run).
//
//   Stage 1 — Discovery
//     Build a cheap DiscoveryCandidate per internal idea + external
//     signal cluster. Pre-score each 0..40 using only pre-research
//     information. Rank. Take the top N.
//
//   Stage 2 — Research
//     For the shortlist only, run the deterministic enrichment
//     pipeline (extraction + entity match + internal links + images
//     + overlap + official corroboration) and compute the final
//     0..100 editorial score.
//
//   Gate
//     Final score >= min_opportunity_score AND evidence_quality='ready'
//     → eligible for the first paid run.
//     Otherwise → HELD.
//
// Fixture executor still runs for the top-scored eligible candidate
// so the preview exercises the full downstream pipeline. No AI call,
// no publishing, no budget reservation.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutopilotSiteSlug } from './config';
import type {
  ArticleTemplateId,
  DiscoveryCandidate,
  EvidenceQualityVerdict,
  PipelineResult,
  ResearchedCandidate,
  SourceTier,
} from './types';
import { loadAutopilotSnapshot } from './config';
import { estimateCost } from './cost-estimator';
import { executeDraft } from './executor';
import { runDeterministicQA } from './qa';
import { draftToBodyRich, type TiptapDoc } from './body-rich';
import { runDiscovery, loadActiveSignals } from './discovery';
import { assemblePrompt, loadVoiceSnapshot, type AssembledPrompt } from './prompt';
import { toDiscoveryCandidate, DISCOVERY_SHORTLIST_SIZE } from './discovery-scoring';
import { researchCandidate } from './research';

export interface PreviewParams {
  sb: SupabaseClient;
  site_slug: AutopilotSiteSlug;
  force_discovery?: boolean;
}

export interface PreviewResult {
  pipeline: PipelineResult;
  body_rich: TiptapDoc | null;
  evidence_quality: EvidenceQualityVerdict;
  stop_reason: string | null;
  discovery_candidates: DiscoveryCandidate[];     // all discovery candidates, sorted by discovery_score desc
  researched_shortlist: ResearchedCandidate[];    // top N researched, sorted by final_score desc
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
  prompt: AssembledPrompt | null;
}

const CHECKPOINT_B_MODE = 'fixture' as const;

export async function previewPipeline(params: PreviewParams): Promise<PreviewResult> {
  const snap = await loadAutopilotSnapshot(params.sb);

  // ── Resolve pilot site ──────────────────────────────────────
  const { data: siteRow } = await params.sb
    .from('network_sites')
    .select('id, slug, name')
    .eq('slug', params.site_slug)
    .maybeSingle();
  if (!siteRow) {
    return emptyPreview('Pilot site not found in network_sites.', snap.global);
  }
  const site = siteRow as { id: string; slug: string; name: string };

  // ── Discovery pass (cached) ─────────────────────────────────
  const discovery = await runDiscovery(params.sb, params.site_slug, { force: params.force_discovery, maxAgeMinutes: 60 });
  const signals = await loadActiveSignals(params.sb, params.site_slug, 50);
  const { count: enabledSourcesCount } = await params.sb
    .from('network_autopilot_sources')
    .select('*', { count: 'exact', head: true })
    .eq('site_slug', params.site_slug)
    .eq('enabled', true);
  const enabledSources = enabledSourcesCount ?? 0;

  // ── Existing article corpus (used both in discovery pre-score
  //    and later for overlap in research) ───────────────────────
  const { data: existingData } = await params.sb
    .from('network_articles')
    .select('id, slug, title, published_at, publication_url')
    .eq('site_id', site.id)
    .in('status', ['published', 'approved', 'scheduled', 'review']);
  const existing_articles = (existingData ?? []) as Array<{ id: string; slug: string; title: string; published_at: string | null; publication_url: string | null }>;

  // ── Stage 1: Build discovery candidate pool ─────────────────
  const discovery_candidates = await buildDiscoveryCandidates(params.sb, site, signals, existing_articles);

  // ── Shortlist for research ──────────────────────────────────
  const shortlistKeys = discovery_candidates
    .slice(0, DISCOVERY_SHORTLIST_SIZE)
    .map((c) => c.key);

  // ── Stage 2: Research each shortlisted candidate ────────────
  const poolForCorroboration = signals.map((s) => ({
    cluster_key: s.cluster_key,
    url: s.url,
    source_name: s.source_name,
    source_tier: s.source_tier,
    domain: s.domain,
  }));

  const researched_shortlist: ResearchedCandidate[] = [];
  for (const c of discovery_candidates) {
    if (!shortlistKeys.includes(c.key)) continue;
    const r = await researchCandidate({
      sb: params.sb,
      site_slug: params.site_slug,
      site_id: site.id,
      site_name: site.name,
      candidate: c,
      all_signals_in_pool: poolForCorroboration,
      existing_articles,
      max_cost_per_article_usd: snap.global.max_cost_per_article_usd,
    });
    researched_shortlist.push(r);
  }
  researched_shortlist.sort((a, b) => b.final_score.total - a.final_score.total);

  // ── Pick top eligible researched candidate ──────────────────
  const chosen = researched_shortlist.find((r) => r.eligible_for_generation) ?? researched_shortlist[0] ?? null;

  // Budget snapshot (so the UI shows real remaining even when held).
  const budget = await loadBudgetFromSnapshot(params.sb, snap.global.daily_article_budget_usd, snap.global.monthly_article_budget_usd);
  const budget_preview_base = {
    projected_cost_usd: 0,
    per_article_cap_usd: snap.global.max_cost_per_article_usd,
    daily_remaining_usd: budget.daily_remaining_usd,
    monthly_remaining_usd: budget.monthly_remaining_usd,
  };

  if (!chosen) {
    return {
      pipeline: {
        mode: CHECKPOINT_B_MODE,
        outcome: 'held',
        hold_reasons: ['evidence_insufficient'],
        opportunity: synthEmptyOpportunity(params.site_slug),
        evidence_pack_id: null,
        evidence_pack: synthEmptyPack('(none)', params.site_slug, site.name, 'evergreen_guide', snap.global.max_cost_per_article_usd),
        draft: null,
        qa: null,
        budget_preview: budget_preview_base,
      },
      body_rich: null,
      evidence_quality: { status: 'held', hold_reasons: ['evidence_insufficient'], warnings: [] },
      stop_reason: discovery_candidates.length === 0
        ? 'Discovery produced no candidates. Enable sources at /admin/content/autopilot/sources OR create an idea.'
        : 'Research produced no shortlist.',
      discovery_candidates,
      researched_shortlist: [],
      discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
      prompt: null,
    };
  }

  // ── Cost estimate for the chosen candidate ──────────────────
  const costEst = await estimateCost(params.sb, chosen.evidence_pack, { include_qa: false });
  chosen.evidence_pack.budget = {
    max_cost_usd: snap.global.max_cost_per_article_usd,
    projected_draft_cost_usd: costEst.projected_draft_usd,
    projected_qa_cost_usd: costEst.qa_model ? costEst.projected_qa_usd : null,
    projected_total_cost_usd: costEst.projected_total_usd,
  };

  const hold_reasons: string[] = [];
  if (chosen.final_score.total < snap.global.min_opportunity_score) hold_reasons.push('below_min_score');
  if (chosen.evidence_quality.status === 'held') hold_reasons.push(...chosen.evidence_quality.hold_reasons);
  if (!costEst.fits) hold_reasons.push(...costEst.blockers);

  // Short-circuit the executor + QA when the candidate is held — no
  // point drafting a fixture if nothing can proceed.
  if (hold_reasons.length > 0) {
    return {
      pipeline: {
        mode: CHECKPOINT_B_MODE,
        outcome: 'held',
        hold_reasons: Array.from(new Set(hold_reasons)),
        opportunity: toScoredShape(chosen),
        evidence_pack_id: null,
        evidence_pack: chosen.evidence_pack,
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
      evidence_quality: chosen.evidence_quality,
      stop_reason: `Pipeline held. Reasons: ${hold_reasons.join(', ')}.`,
      discovery_candidates,
      researched_shortlist,
      discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
      prompt: null,
    };
  }

  // ── Fixture executor + QA for the eligible chosen one ───────
  const voice = await loadVoiceSnapshot(params.sb, site.id);
  const prompt = assemblePrompt({
    pack: chosen.evidence_pack,
    voice,
    approved_internal_links: chosen.internal_links_outbound,
  });
  const exec = await executeDraft(params.sb, { mode: CHECKPOINT_B_MODE, pack: chosen.evidence_pack });
  const bodyRich = draftToBodyRich(exec.draft);
  const { report, repaired } = await runDeterministicQA({
    sb: params.sb,
    pack: chosen.evidence_pack,
    draft: exec.draft,
    site_id: site.id,
  });

  const outcome: PipelineResult['outcome'] =
    report.blocker_count > 0 ? 'held' : 'ready_for_first_paid_run';
  const qa_holds: string[] = [];
  for (const f of report.findings) {
    if (f.severity !== 'blocker') continue;
    if (f.check_name === 'slug_unique' || f.check_name === 'title_cannibalisation') qa_holds.push('title_cannibalisation');
    else if (f.check_name === 'price_claim_traceable' || f.check_name === 'percentage_claim_traceable') qa_holds.push('price_claim_failed');
    else if (f.check_name === 'image_resolves') qa_holds.push('image_missing');
    else if (f.check_name === 'banned_filler_phrase' || f.check_name === 'body_rich_sanitised') qa_holds.push('semantic_qa_failed');
  }

  return {
    pipeline: {
      mode: CHECKPOINT_B_MODE,
      outcome: qa_holds.length > 0 ? 'held' : outcome,
      hold_reasons: Array.from(new Set(qa_holds)),
      opportunity: toScoredShape(chosen),
      evidence_pack_id: null,
      evidence_pack: chosen.evidence_pack,
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
    evidence_quality: chosen.evidence_quality,
    stop_reason: qa_holds.length > 0 ? `Pipeline held. Reasons: ${qa_holds.join(', ')}.` : null,
    discovery_candidates,
    researched_shortlist,
    discovery: { ...discoveryToSummary(discovery), total_active_signals: signals.length, enabled_sources: enabledSources },
    prompt,
  };
}

// ─── Stage 1 ───────────────────────────────────────────────────

async function buildDiscoveryCandidates(
  sb: SupabaseClient,
  site: { id: string; name: string },
  signals: Awaited<ReturnType<typeof loadActiveSignals>>,
  existing_articles: Array<{ id: string; title: string }>,
): Promise<DiscoveryCandidate[]> {
  // ── Internal ideas ────────────────────────────────────────
  const { data: ideaData } = await sb
    .from('network_content_ideas')
    .select('id, working_title, content_type, status')
    .eq('site_id', site.id)
    .in('status', ['new', 'in_brief'])
    .order('priority', { ascending: false })
    .limit(10);
  const internal = (ideaData ?? []) as Array<{ id: string; working_title: string; content_type: string }>;

  // ── External clusters ─────────────────────────────────────
  const clusters = new Map<string, typeof signals>();
  for (const s of signals) {
    const key = s.cluster_key ?? `url:${s.url}`;
    const bucket = clusters.get(key) ?? [];
    bucket.push(s);
    clusters.set(key, bucket);
  }

  const candidates: DiscoveryCandidate[] = [];
  for (const idea of internal) {
    const existingSimilar = existing_articles.filter((a) => lexicalOverlap(idea.working_title, a.title) > 0.3).length;
    const template_id = toTemplate(idea.content_type);
    candidates.push(toDiscoveryCandidate('internal_idea', idea.id, idea.working_title, template_id, [], existingSimilar));
  }
  for (const [key, clusterSignals] of clusters.entries()) {
    const title = clusterSignals[0]!.title;
    const existingSimilar = existing_articles.filter((a) => lexicalOverlap(title, a.title) > 0.3).length;
    const hasAuth = clusterSignals.some((s) => s.source_tier !== 'community');
    const template_id: ArticleTemplateId = hasAuth ? 'news' : 'trend_story';
    candidates.push(toDiscoveryCandidate('external_cluster', key, title, template_id, clusterSignals, existingSimilar));
  }

  candidates.sort((a, b) => b.discovery_score - a.discovery_score);
  return candidates;
}

// ─── Helpers ───────────────────────────────────────────────────

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

function lexicalOverlap(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const tokensB = new Set(b.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter += 1;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : inter / union;
}

async function loadBudgetFromSnapshot(sb: SupabaseClient, dailyCap: number, monthlyCap: number): Promise<{ daily_remaining_usd: number; monthly_remaining_usd: number }> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(dayStart.getUTCFullYear(), dayStart.getUTCMonth(), 1));
  const { data: rows } = await sb
    .from('network_ai_budget_reservations')
    .select('status, estimated_cost_usd, actual_cost_usd, created_at')
    .in('status', ['reserved', 'consumed'])
    .gte('created_at', monthStart.toISOString())
    .limit(5_000);
  let today = 0, month = 0;
  for (const r of (rows ?? []) as Array<{ status: string; estimated_cost_usd: number; actual_cost_usd: number | null; created_at: string }>) {
    const eff = r.actual_cost_usd ?? r.estimated_cost_usd ?? 0;
    month += eff;
    if (r.created_at >= dayStart.toISOString()) today += eff;
  }
  return {
    daily_remaining_usd: Math.max(0, dailyCap - today),
    monthly_remaining_usd: Math.max(0, monthlyCap - month),
  };
}

function toScoredShape(r: ResearchedCandidate): PipelineResult['opportunity'] {
  return {
    idea_id: r.discovery.kind === 'internal_idea' ? r.discovery.key : `ext:${r.discovery.key}`,
    site_slug: r.evidence_pack.site.slug,
    working_title: r.discovery.working_title,
    template_id: r.discovery.template_id,
    score: r.final_score,
    routing: r.routing,
    evidence_summary: {
      market_observations: r.evidence_pack.market_data.length,
      search_observations: r.evidence_pack.search_data.length,
      related_pages: r.evidence_pack.related_pages.length,
      images_available: r.evidence_pack.images.length,
      internal_link_candidates: r.internal_links_outbound.length,
      existing_similar_articles: r.existing_similar_count,
    },
  };
}

function synthEmptyOpportunity(siteSlug: AutopilotSiteSlug): PipelineResult['opportunity'] {
  return {
    idea_id: '',
    site_slug: siteSlug,
    working_title: '(none)',
    template_id: 'evergreen_guide',
    score: { total: 0, components: {
      search_potential: 0, market_significance: 0, timeliness: 0, evidence_quality: 0,
      commercial_relevance: 0, internal_link_opportunity: 0, existing_content_gap: 0,
      newsworthiness: 0, source_authority: 0,
      duplication_penalty: 0, source_agreement_penalty: 0, effort_adjustment: 0,
    }, rationale: [] },
    routing: { decision: 'skip', reason: 'no candidate', target_article_id: null, target_url: null },
    evidence_summary: { market_observations: 0, search_observations: 0, related_pages: 0, images_available: 0, internal_link_candidates: 0, existing_similar_articles: 0 },
  };
}

function synthEmptyPack(title: string, slug: AutopilotSiteSlug, siteName: string, template: ArticleTemplateId, cap: number): PipelineResult['evidence_pack'] {
  return {
    schema_version: '2',
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
    article_angle: { anchor: 'explainer', one_line: '', must_cover: [], must_not_cover: [], dominant_tier: 'internal' },
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

function emptyPreview(reason: string, g: Awaited<ReturnType<typeof loadAutopilotSnapshot>>['global']): PreviewResult {
  return {
    pipeline: {
      mode: CHECKPOINT_B_MODE,
      outcome: 'held',
      hold_reasons: ['evidence_insufficient'],
      opportunity: synthEmptyOpportunity('ygo'),
      evidence_pack_id: null,
      evidence_pack: synthEmptyPack('(none)', 'ygo', 'YGOPrices', 'evergreen_guide', g.max_cost_per_article_usd),
      draft: null,
      qa: null,
      budget_preview: {
        projected_cost_usd: 0,
        per_article_cap_usd: g.max_cost_per_article_usd,
        daily_remaining_usd: g.daily_article_budget_usd,
        monthly_remaining_usd: g.monthly_article_budget_usd,
      },
    },
    body_rich: null,
    evidence_quality: { status: 'held', hold_reasons: ['evidence_insufficient'], warnings: [] },
    stop_reason: reason,
    discovery_candidates: [],
    researched_shortlist: [],
    discovery: { cached: false, cache_age_minutes: null, sources_scanned: 0, signals_found: 0, signals_inserted: 0, errors: [], total_active_signals: 0, enabled_sources: 0 },
    prompt: null,
  };
}

// Re-export the SourceTier so callers can still see it via pipeline.ts.
export type { SourceTier };
