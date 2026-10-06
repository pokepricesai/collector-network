import 'server-only';

// Opportunity scoring (0..100) + routing (new / refresh / internal_link / skip).
//
// Deterministic. No LLM involvement. Every point is derived from a
// visible signal so the admin UI can show the reasoning line-by-line.
//
// Components:
//   search_potential            0..20
//   market_significance         0..20
//   timeliness                  0..15
//   evidence_quality            0..15
//   commercial_relevance        0..10
//   internal_link_opportunity   0..10
//   existing_content_gap        0..10
//   duplication_penalty        -20..0
//   effort_adjustment           -5..+5
//   -------------------------------
//   TOTAL (clamped)             0..100

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ArticleTemplateId,
  OpportunityScore,
  OpportunityScoreComponents,
  RoutingDecision,
  RoutingResult,
  ScoredOpportunity,
} from './types';
import type { AutopilotSiteSlug } from './config';

export interface ScoringSignals {
  // Internal — unchanged.
  search_impressions_28d: number;
  search_clicks_28d: number;
  search_position_avg: number | null;
  search_striking_distance_count: number;
  market_observations: number;
  market_max_abs_percentage_change: number;
  signal_age_days: number;
  images_available: number;
  internal_link_candidates: number;
  related_pages: number;
  affiliate_links_available: number;
  existing_similar_articles: number;
  closest_existing_overlap: number;
  closest_existing_age_days: number | null;
  template_complexity: 'low' | 'medium' | 'high';

  // External — new in Checkpoint B.1.
  external_source_count: number;              // total external signals pointing at this topic
  external_official_count: number;            // of those, how many are tier-1
  external_secondary_count: number;           // tier-2
  external_community_count: number;           // tier-3
  external_distinct_domains: number;          // how many separate publishers agree
  external_newest_age_days: number | null;    // freshness of the newest external signal
}

export interface ScoringInputs {
  idea_id: string;
  site_slug: AutopilotSiteSlug;
  working_title: string;
  template_id: ArticleTemplateId;
  signals: ScoringSignals;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function scoreOpportunity(inputs: ScoringInputs): OpportunityScore {
  const s = inputs.signals;
  const rationale: string[] = [];

  // Weights were rebalanced in Checkpoint B.1 to make room for
  // external signals. Positives sum to 100.

  // 1. Search potential ─ 0..15.
  const imp = s.search_impressions_28d;
  const impPts =
    imp >= 20_000 ? 9 :
    imp >= 5_000  ? 7 :
    imp >= 1_000  ? 5 :
    imp >= 100    ? 2 : 0;
  const sdPts = clamp(Math.round(s.search_striking_distance_count / 2), 0, 6);
  const search_potential = clamp(impPts + sdPts, 0, 15);
  if (imp > 0) rationale.push(`Search: ${imp.toLocaleString()} impressions (28d) + ${s.search_striking_distance_count} striking-distance quer${s.search_striking_distance_count === 1 ? 'y' : 'ies'} → ${search_potential}/15`);

  // 2. Market significance ─ 0..15. Needs ≥3 observations to register.
  const obs = s.market_observations;
  const pct = Math.min(150, Math.abs(s.market_max_abs_percentage_change));
  const obsPts = obs >= 20 ? 6 : obs >= 10 ? 4 : obs >= 3 ? 2 : 0;
  const pctPts = clamp(Math.round(pct / 18), 0, 9);
  const market_significance = obs >= 3 ? clamp(obsPts + pctPts, 0, 15) : 0;
  if (obs > 0) rationale.push(`Market: ${obs} observations, max |%Δ| = ${pct.toFixed(1)} → ${market_significance}/15`);

  // 3. Timeliness ─ 0..10.
  const age = Math.max(0, Math.min(s.signal_age_days, s.external_newest_age_days ?? s.signal_age_days));
  const timeliness =
    age <= 1  ? 10 :
    age <= 3  ? 8  :
    age <= 7  ? 6  :
    age <= 14 ? 4  :
    age <= 30 ? 2  : 0;
  rationale.push(`Timeliness: freshest signal ${age}d old → ${timeliness}/10`);

  // 4. Evidence quality ─ 0..10. Internal depth only.
  const evidence_quality = clamp(
    Math.round(Math.min(5, s.images_available) * 1.0) +
    Math.round(Math.min(10, s.internal_link_candidates) * 0.3) +
    Math.round(Math.min(10, s.related_pages) * 0.2),
    0, 10,
  );
  rationale.push(`Evidence depth: ${s.images_available} image(s), ${s.internal_link_candidates} link candidate(s), ${s.related_pages} related → ${evidence_quality}/10`);

  // 5. Commercial ─ 0..10.
  const commercial_relevance = clamp(Math.round(Math.min(10, s.affiliate_links_available)), 0, 10);
  if (s.affiliate_links_available > 0) rationale.push(`Commercial: ${s.affiliate_links_available} affiliate link(s) → ${commercial_relevance}/10`);

  // 6. Internal-link opportunity ─ 0..10.
  const internal_link_opportunity = clamp(Math.round(Math.min(10, s.internal_link_candidates * 0.8)), 0, 10);

  // 7. Existing-content gap ─ 0..10.
  const gap =
    s.existing_similar_articles === 0 ? 10 :
    s.existing_similar_articles === 1 && s.closest_existing_overlap < 0.3 ? 8 :
    s.existing_similar_articles <= 2 && s.closest_existing_overlap < 0.5 ? 5 :
    s.closest_existing_overlap < 0.7 ? 2 : 0;
  const existing_content_gap = gap;
  if (s.existing_similar_articles === 0) rationale.push(`No existing article covers this topic — strong editorial gap → 10/10`);
  else rationale.push(`${s.existing_similar_articles} similar article(s); closest overlap ${s.closest_existing_overlap.toFixed(2)} → ${existing_content_gap}/10`);

  // 8. Newsworthiness ─ 0..10. External signal strength.
  const newsworthiness = clamp(
    Math.min(5, s.external_source_count) + Math.min(5, s.external_distinct_domains),
    0, 10,
  );
  if (s.external_source_count > 0) {
    rationale.push(`Newsworthiness: ${s.external_source_count} external signal(s) across ${s.external_distinct_domains} publisher(s) → ${newsworthiness}/10`);
  }

  // 9. Source authority ─ 0..10. Tier-weighted.
  const source_authority = clamp(
    Math.min(6, s.external_official_count * 6) +
    Math.min(4, s.external_secondary_count * 2),
    0, 10,
  );
  if (s.external_official_count + s.external_secondary_count > 0) {
    rationale.push(`Source authority: ${s.external_official_count} official + ${s.external_secondary_count} secondary → ${source_authority}/10`);
  }

  // Penalties
  let duplication_penalty = 0;
  if (s.closest_existing_overlap >= 0.8) duplication_penalty = -20;
  else if (s.closest_existing_overlap >= 0.6) duplication_penalty = -10;
  else if (s.closest_existing_overlap >= 0.4) duplication_penalty = -4;
  if (duplication_penalty !== 0) rationale.push(`Duplication risk: overlap ${s.closest_existing_overlap.toFixed(2)} → ${duplication_penalty}`);

  // Single-source community penalty: a story backed only by one tier-3
  // signal is a lead, not evidence. Flag it so community-only "news"
  // candidates don't float to the top.
  let source_agreement_penalty = 0;
  if (s.external_source_count > 0 && s.external_official_count === 0 && s.external_secondary_count === 0) {
    source_agreement_penalty = s.external_source_count === 1 ? -10 : -5;
    rationale.push(`Source agreement: only community-tier signals (${s.external_source_count}) → ${source_agreement_penalty}`);
  }

  const effort_adjustment =
    s.template_complexity === 'low'    ?  3 :
    s.template_complexity === 'medium' ?  0 :
    s.template_complexity === 'high'   ? -3 : 0;
  rationale.push(`Template complexity: ${s.template_complexity} → ${effort_adjustment > 0 ? '+' : ''}${effort_adjustment}`);

  const components: OpportunityScoreComponents = {
    search_potential,
    market_significance,
    timeliness,
    evidence_quality,
    commercial_relevance,
    internal_link_opportunity,
    existing_content_gap,
    newsworthiness,
    source_authority,
    duplication_penalty,
    source_agreement_penalty,
    effort_adjustment,
  };
  const total = clamp(
    search_potential + market_significance + timeliness + evidence_quality +
    commercial_relevance + internal_link_opportunity + existing_content_gap +
    newsworthiness + source_authority +
    duplication_penalty + source_agreement_penalty + effort_adjustment,
    0, 100,
  );
  return { total, components, rationale };
}

// ─── Routing: new vs refresh vs internal-link vs skip ──────────
//
// Rules (deterministic):
//   1. If an existing article overlaps ≥ 0.75 → prefer refresh (not duplicate).
//   2. Elif an existing article overlaps ≥ 0.50 AND the article is > 90 days old → refresh.
//   3. Elif existing article overlaps 0.30..0.50 → internal_link_reinforce.
//   4. Elif score < min threshold → skip (handled by caller against config).
//   5. Else → new_article.

export function routeOpportunity(inputs: ScoringInputs, existing: Array<{ article_id: string | null; url: string; overlap: number; age_days: number | null }>): RoutingResult {
  if (existing.length === 0) {
    return { decision: 'new_article', reason: 'No existing article covers this topic.', target_article_id: null, target_url: null };
  }
  const closest = existing.slice().sort((a, b) => b.overlap - a.overlap)[0];
  if (!closest) {
    return { decision: 'new_article', reason: 'No existing article covers this topic.', target_article_id: null, target_url: null };
  }
  if (closest.overlap >= 0.75) {
    return {
      decision: 'refresh',
      reason: `Existing article overlaps ${closest.overlap.toFixed(2)} — refresh instead of duplicating.`,
      target_article_id: closest.article_id,
      target_url: closest.url,
    };
  }
  if (closest.overlap >= 0.5 && (closest.age_days ?? 0) > 90) {
    return {
      decision: 'refresh',
      reason: `Existing article overlaps ${closest.overlap.toFixed(2)} and is ${closest.age_days}d old — refresh.`,
      target_article_id: closest.article_id,
      target_url: closest.url,
    };
  }
  if (closest.overlap >= 0.3) {
    return {
      decision: 'internal_link_reinforce',
      reason: `Existing article overlaps ${closest.overlap.toFixed(2)} — reinforce internal links rather than write new.`,
      target_article_id: closest.article_id,
      target_url: closest.url,
    };
  }
  return {
    decision: 'new_article',
    reason: `Closest existing article overlap is ${closest.overlap.toFixed(2)} — safe to write new.`,
    target_article_id: null,
    target_url: null,
  };
}

export interface PersistParams {
  sb: SupabaseClient;
  idea_id: string;
  score: OpportunityScore;
  routing: RoutingResult;
}
export async function persistScoring(p: PersistParams): Promise<{ ok: boolean; error?: string }> {
  const { error } = await p.sb.from('network_content_ideas').update({
    score: p.score.total,
    score_breakdown: p.score as unknown as Record<string, unknown>,
    decision: p.routing.decision,
    target_article_id: p.routing.target_article_id,
    autopilot_state: 'scored',
    scored_at: new Date().toISOString(),
  }).eq('id', p.idea_id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Composite helper so the preview page / orchestrator can score +
// route in one call. Returns the full ScoredOpportunity.
export function buildScoredOpportunity(inputs: ScoringInputs, existing: Array<{ article_id: string | null; url: string; overlap: number; age_days: number | null }>): ScoredOpportunity {
  const score = scoreOpportunity(inputs);
  const routing = routeOpportunity(inputs, existing);
  const decision: RoutingDecision = routing.decision;
  return {
    idea_id: inputs.idea_id,
    site_slug: inputs.site_slug,
    working_title: inputs.working_title,
    template_id: inputs.template_id,
    score,
    routing: { ...routing, decision },
    evidence_summary: {
      market_observations: inputs.signals.market_observations,
      search_observations: Math.max(0, inputs.signals.search_striking_distance_count),
      related_pages: inputs.signals.related_pages,
      images_available: inputs.signals.images_available,
      internal_link_candidates: inputs.signals.internal_link_candidates,
      existing_similar_articles: inputs.signals.existing_similar_articles,
    },
  };
}
