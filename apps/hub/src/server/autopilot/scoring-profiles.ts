import 'server-only';

// Article-type-aware scoring profiles.
//
// Each profile allocates 100 points across nine named dimensions.
// Dimensions with weight 0 don't contribute to the final score — they
// are NOT penalised to zero on a missing-but-irrelevant basis. This
// is the critical fix in Checkpoint B.3: a NEWS article isn't
// mathematically crippled for lacking search demand or market signals.
//
// The RAW_MAX constants are the natural caps each raw signal produces
// in opportunity-scoring.ts. Final contribution per dimension is
//
//     raw_value / RAW_MAX * profile.weight
//
// Penalties (duplication_penalty, source_agreement_penalty) and
// effort_adjustment are applied flat on top of the weighted sum.

import type { ArticleTemplateId } from './types';

export type ScoringDimension =
  | 'search_potential'
  | 'market_significance'
  | 'timeliness'
  | 'evidence_quality'
  | 'commercial_relevance'
  | 'internal_link_opportunity'
  | 'existing_content_gap'
  | 'newsworthiness'
  | 'source_authority';

export interface ScoringProfile {
  template_id: ArticleTemplateId;
  label: string;
  description: string;
  weights: Record<ScoringDimension, number>;
}

// Raw caps from the signal calculators (opportunity-scoring.ts).
// Kept here so profile math stays consistent with signal math.
export const RAW_MAX: Record<ScoringDimension, number> = Object.freeze({
  search_potential: 15,
  market_significance: 15,
  timeliness: 10,
  evidence_quality: 10,
  commercial_relevance: 10,
  internal_link_opportunity: 10,
  existing_content_gap: 10,
  newsworthiness: 10,
  source_authority: 10,
});

const PROFILE: Record<ArticleTemplateId, ScoringProfile> = {
  news: {
    template_id: 'news',
    label: 'News',
    description: 'External announcement. Fresh, well-sourced, authoritative. Search / market / commercial not required.',
    weights: {
      timeliness: 20,
      newsworthiness: 20,
      source_authority: 20,
      evidence_quality: 15,
      existing_content_gap: 10,
      internal_link_opportunity: 10,
      search_potential: 5,
      market_significance: 0,
      commercial_relevance: 0,
    },
  },
  trend_story: {
    template_id: 'trend_story',
    label: 'Trend story',
    description: 'Community-driven story. Source agreement + breadth matter; timeliness essential; market and commercial optional.',
    weights: {
      newsworthiness: 20,
      timeliness: 20,
      evidence_quality: 15,
      existing_content_gap: 15,
      source_authority: 10,
      internal_link_opportunity: 10,
      search_potential: 5,
      market_significance: 5,
      commercial_relevance: 0,
    },
  },
  tournament_context: {
    template_id: 'tournament_context',
    label: 'Tournament context',
    description: 'Event coverage. Sources + timeliness lead; internal links and evidence support.',
    weights: {
      newsworthiness: 20,
      source_authority: 20,
      timeliness: 15,
      evidence_quality: 15,
      internal_link_opportunity: 10,
      existing_content_gap: 10,
      search_potential: 5,
      market_significance: 5,
      commercial_relevance: 0,
    },
  },
  set_deep_dive: {
    template_id: 'set_deep_dive',
    label: 'Set deep dive',
    description: 'Historical / collectability deep dive. Evidence depth + internal links + current market signal.',
    weights: {
      evidence_quality: 20,
      internal_link_opportunity: 15,
      existing_content_gap: 15,
      source_authority: 10,
      market_significance: 10,
      commercial_relevance: 10,
      search_potential: 10,
      newsworthiness: 5,
      timeliness: 5,
    },
  },
  card_deep_dive: {
    template_id: 'card_deep_dive',
    label: 'Card deep dive',
    description: 'Printings + market position + collector context on a single card.',
    weights: {
      evidence_quality: 20,
      market_significance: 15,
      internal_link_opportunity: 15,
      existing_content_gap: 10,
      commercial_relevance: 10,
      search_potential: 10,
      source_authority: 10,
      newsworthiness: 5,
      timeliness: 5,
    },
  },
  card_guide: {
    template_id: 'card_guide',
    label: 'Card guide',
    description: 'Compact card walk-through. Market + evidence + links.',
    weights: {
      evidence_quality: 20,
      market_significance: 15,
      internal_link_opportunity: 15,
      existing_content_gap: 10,
      commercial_relevance: 10,
      search_potential: 10,
      source_authority: 10,
      newsworthiness: 5,
      timeliness: 5,
    },
  },
  set_guide: {
    template_id: 'set_guide',
    label: 'Set guide',
    description: 'Compact set walk-through.',
    weights: {
      evidence_quality: 20,
      internal_link_opportunity: 15,
      existing_content_gap: 15,
      market_significance: 10,
      commercial_relevance: 10,
      search_potential: 10,
      source_authority: 10,
      newsworthiness: 5,
      timeliness: 5,
    },
  },
  archetype_guide: {
    template_id: 'archetype_guide',
    label: 'Archetype guide',
    description: 'Theme/archetype guide. Internal links + evidence lead; some search demand expected.',
    weights: {
      evidence_quality: 20,
      internal_link_opportunity: 20,
      existing_content_gap: 15,
      search_potential: 15,
      commercial_relevance: 10,
      source_authority: 10,
      market_significance: 5,
      newsworthiness: 5,
      timeliness: 0,
    },
  },
  collector_guide: {
    template_id: 'collector_guide',
    label: 'Collector guide',
    description: 'Collector-focused evergreen. Evidence + commercial + search + links.',
    weights: {
      evidence_quality: 20,
      search_potential: 15,
      existing_content_gap: 15,
      internal_link_opportunity: 15,
      commercial_relevance: 15,
      source_authority: 10,
      market_significance: 5,
      newsworthiness: 5,
      timeliness: 0,
    },
  },
  evergreen_guide: {
    template_id: 'evergreen_guide',
    label: 'Evergreen guide',
    description: 'Search-led explainer. Search demand + content gap + internal links dominant.',
    weights: {
      search_potential: 25,
      evidence_quality: 15,
      existing_content_gap: 15,
      internal_link_opportunity: 15,
      source_authority: 10,
      commercial_relevance: 10,
      newsworthiness: 5,
      timeliness: 5,
      market_significance: 0,
    },
  },
  search_led: {
    template_id: 'search_led',
    label: 'Search-led',
    description: 'Intent-matched article for a specific query cluster.',
    weights: {
      search_potential: 25,
      evidence_quality: 15,
      existing_content_gap: 15,
      internal_link_opportunity: 15,
      source_authority: 10,
      commercial_relevance: 10,
      newsworthiness: 5,
      timeliness: 5,
      market_significance: 0,
    },
  },
  market_movers: {
    template_id: 'market_movers',
    label: 'Market movers',
    description: 'Quantitative price-movement piece. Market signal dominant.',
    weights: {
      market_significance: 30,
      evidence_quality: 15,
      commercial_relevance: 15,
      timeliness: 10,
      internal_link_opportunity: 10,
      search_potential: 10,
      existing_content_gap: 5,
      newsworthiness: 3,
      source_authority: 2,
    },
  },
  retrospective: {
    template_id: 'retrospective',
    label: 'Retrospective',
    description: 'Historical retrospective anchored to dated sources.',
    weights: {
      evidence_quality: 20,
      source_authority: 15,
      internal_link_opportunity: 15,
      existing_content_gap: 15,
      search_potential: 10,
      newsworthiness: 10,
      commercial_relevance: 5,
      market_significance: 5,
      timeliness: 5,
    },
  },
  refresh: {
    template_id: 'refresh',
    label: 'Refresh',
    description: 'Update existing article. Timeliness + market/evidence drive value.',
    weights: {
      timeliness: 20,
      evidence_quality: 15,
      market_significance: 15,
      internal_link_opportunity: 10,
      search_potential: 10,
      newsworthiness: 10,
      source_authority: 10,
      existing_content_gap: 5,
      commercial_relevance: 5,
    },
  },
};

// Sanity-check at module load — every profile must sum to exactly 100.
for (const [id, p] of Object.entries(PROFILE)) {
  const sum = Object.values(p.weights).reduce((a, b) => a + b, 0);
  if (sum !== 100) {
    throw new Error(`Scoring profile "${id}" weights sum to ${sum}, expected 100`);
  }
}

export function getProfile(templateId: ArticleTemplateId): ScoringProfile {
  return PROFILE[templateId];
}

export function listProfiles(): ScoringProfile[] {
  return Object.values(PROFILE);
}

export interface WeightedDimensionResult {
  dimension: ScoringDimension;
  raw: number;         // 0..RAW_MAX[dimension]
  raw_max: number;
  weight: number;      // 0..100 share for this template
  contribution: number; // (raw / raw_max) * weight
  used: boolean;       // true when weight > 0
}

// Apply a profile to raw component values. Returns the dimension
// breakdown plus the final weighted sum.
export function applyProfile(
  templateId: ArticleTemplateId,
  raw: Record<ScoringDimension, number>,
): { profile: ScoringProfile; breakdown: WeightedDimensionResult[]; weighted_sum: number } {
  const profile = getProfile(templateId);
  const breakdown: WeightedDimensionResult[] = [];
  let weighted_sum = 0;
  for (const dim of (Object.keys(RAW_MAX) as ScoringDimension[])) {
    const r = Math.max(0, Math.min(raw[dim] ?? 0, RAW_MAX[dim]));
    const w = profile.weights[dim] ?? 0;
    const contribution = w === 0 ? 0 : (r / RAW_MAX[dim]) * w;
    breakdown.push({
      dimension: dim,
      raw: r,
      raw_max: RAW_MAX[dim],
      weight: w,
      contribution,
      used: w > 0,
    });
    weighted_sum += contribution;
  }
  return { profile, breakdown, weighted_sum };
}
