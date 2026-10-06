import 'server-only';

// Shared types for the Article Autopilot pipeline.
//
// Flow:
//   Opportunity (scored) → Decision (new/refresh/skip)
//     → EvidencePack (frozen jsonb) → Template → GenerationPlan
//     → DraftOutput (via REAL or FIXTURE model)
//     → QAReport (deterministic + optional semantic)
//     → PublishDecision (ready-to-publish | hold)
//
// Everything is deterministic and reviewable except the AI call.
// Checkpoint B exercises the whole pipeline in FIXTURE mode.

import type { AutopilotSiteSlug } from './config';

// ────────────────────────── Templates ──────────────────────────

export type ArticleTemplateId =
  | 'market_movers'
  | 'set_guide'
  | 'card_guide'
  | 'evergreen_guide'
  | 'refresh';

// Which evidence slots a section can reference. The prompt builder
// uses this to restrict what the AI sees per section, and the QA
// pass uses it to decide what a section's factual claims may draw
// from.
export type EvidenceField =
  | 'market_data'
  | 'search_data'
  | 'related_pages'
  | 'internal_links'
  | 'existing_content'
  | 'images'
  | 'commercial_links'
  | 'topic'
  | 'date_range'
  | 'methodology';

export interface TemplateSection {
  id: string;                       // 'intro', 'top_movers', ...
  heading_level: 1 | 2 | 3 | null;  // null = standfirst / no heading
  title_hint: string;               // human copy to drive the model
  min_sentences?: number;
  max_sentences?: number;
  evidence: EvidenceField[];        // allowed evidence
  required: boolean;                // must appear in output
}

export interface ArticleTemplate {
  id: ArticleTemplateId;
  label: string;
  description: string;
  sections: TemplateSection[];
  min_evidence: {
    market_data?: number;
    search_data?: number;
    images?: number;
  };
}

// ────────────────────── Evidence pack ──────────────────────────

export interface MarketObservation {
  card_id: string;
  card_name: string;
  card_slug: string;
  set_name: string | null;
  set_code: string | null;
  printing: string | null;         // e.g. 'Starlight Rare' | '1st Edition'
  start_date: string;              // YYYY-MM-DD
  end_date: string;                // YYYY-MM-DD
  start_price_minor: number;
  end_price_minor: number;
  absolute_change_minor: number;   // deterministic: end - start
  percentage_change: number;       // deterministic: ((end - start) / start) * 100
  currency: string;
  observation_count: number;       // number of underlying price points
  source: string;                  // e.g. 'ygo_prices.v1'
}

export interface SearchObservation {
  query: string;
  page_url: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  avg_position: number;
  period_days: number;
}

export interface RelatedPage {
  url: string;
  title: string | null;
  kind: 'card' | 'set' | 'guide' | 'tool' | 'article';
  slug: string | null;
}

export interface EvidenceInternalLink {
  target_url: string;
  anchor_concepts: string[];        // natural phrases the writer may form anchors from
  reason: 'authority_handoff' | 'query_cluster' | 'orphan_support' | 'card_mention' | 'set_mention';
  priority: number;                 // 0..100 sort order
}

export interface ExistingContentRef {
  article_id: string | null;
  slug: string;
  url: string;
  title: string;
  overlap_score: number;            // 0..1 similarity vs the proposed topic
  gsc_28d_clicks: number;
  gsc_28d_impressions: number;
  gsc_28d_position: number | null;
  age_days: number | null;
}

export interface EvidenceImage {
  media_id: string | null;          // network_media.id if already in library
  source_url: string;
  alt_text: string;
  width: number | null;
  height: number | null;
  card_slug: string | null;
  set_code: string | null;
  role_suggestion: 'featured' | 'inline' | null;
}

export interface CommercialLink {
  destination: 'ebay';
  card_slug: string;
  card_name: string;
  url: string;
  tracking: {
    shared_id: string;              // EPN SharedId (campaign tracker)
    sub_id_1?: string;
    sub_id_2?: string;
    sub_id_3?: string;
  };
}

export interface GenerationConstraints {
  template_id: ArticleTemplateId;
  max_output_tokens: number;
  target_word_count_min: number;
  target_word_count_max: number;
  banned_phrases: string[];
}

export interface EvidencePackPayload {
  schema_version: '1';
  site: { slug: AutopilotSiteSlug; name: string };
  topic: {
    kind: ArticleTemplateId;
    working_title: string;
    primary_query: string | null;
    secondary_queries: string[];
    summary: string | null;
  };
  date_range: { from: string; to: string };
  methodology: string;
  market_data: MarketObservation[];
  search_data: SearchObservation[];
  related_pages: RelatedPage[];
  internal_links: EvidenceInternalLink[];
  existing_content: ExistingContentRef[];
  images: EvidenceImage[];
  commercial_links: CommercialLink[];
  generation_constraints: GenerationConstraints;
  budget: {
    max_cost_usd: number;
    projected_draft_cost_usd: number;
    projected_qa_cost_usd: number | null;
    projected_total_cost_usd: number;
  };
}

export interface EvidenceQualityVerdict {
  status: 'ready' | 'held';
  hold_reasons: string[];
  warnings: string[];
}

// ────────────────────── Opportunity + scoring ──────────────────

export interface OpportunityScoreComponents {
  // Each component scored 0..its weight. Final score is the sum.
  search_potential: number;         // 0..20
  market_significance: number;      // 0..20
  timeliness: number;               // 0..15
  evidence_quality: number;         // 0..15
  commercial_relevance: number;     // 0..10
  internal_link_opportunity: number; // 0..10
  existing_content_gap: number;     // 0..10
  // Adjustments (can be negative)
  duplication_penalty: number;      // -20..0
  effort_adjustment: number;        // -5..+5
}

export interface OpportunityScore {
  total: number;                    // 0..100 clamped
  components: OpportunityScoreComponents;
  rationale: string[];              // human-readable, 1 line per interesting signal
}

export type RoutingDecision = 'new_article' | 'refresh' | 'internal_link_reinforce' | 'skip';

export interface RoutingResult {
  decision: RoutingDecision;
  reason: string;
  target_article_id: string | null;   // when refresh
  target_url: string | null;
}

export interface ScoredOpportunity {
  idea_id: string;
  site_slug: AutopilotSiteSlug;
  working_title: string;
  template_id: ArticleTemplateId;
  score: OpportunityScore;
  routing: RoutingResult;
  // Evidence summary — the full pack is persisted separately.
  evidence_summary: {
    market_observations: number;
    search_observations: number;
    related_pages: number;
    images_available: number;
    internal_link_candidates: number;
    existing_similar_articles: number;
  };
}

// ────────────────────── Generation + model ─────────────────────

export type ExecutionMode = 'fixture' | 'real';

export interface ModelExecutionResult {
  mode: ExecutionMode;
  model: string;
  provider: string;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_write: number;
  };
  cost_usd: number;                 // 0 in fixture mode
  draft: DraftOutput;
  latency_ms: number;
}

// Structured draft output — the AI is instructed to return exactly
// this JSON shape so we can deterministically render body_rich.
export interface DraftOutput {
  title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  featured_image_source_url: string | null;
  sections: DraftSection[];
}

export interface DraftSection {
  id: string;                       // matches TemplateSection.id
  heading: string | null;
  heading_level: 1 | 2 | 3 | null;  // mirrors TemplateSection.heading_level
  paragraphs: string[];             // plain text; markdown links allowed
  internal_links: Array<{ anchor: string; target_url: string }>;
  images: Array<{ source_url: string; alt_text: string }>;
}

// ────────────────────── QA pipeline ────────────────────────────

export type QACheckName =
  | 'price_claim_traceable'
  | 'percentage_claim_traceable'
  | 'card_name_valid'
  | 'set_name_valid'
  | 'date_valid'
  | 'slug_unique'
  | 'title_cannibalisation'
  | 'internal_link_resolves'
  | 'image_resolves'
  | 'heading_structure'
  | 'body_rich_sanitised'
  | 'duplicate_content'
  | 'banned_filler_phrase'
  | 'unsupported_number';

export type QASeverity = 'blocker' | 'warning' | 'info';
export type QASource = 'deterministic' | 'semantic_ai';

export interface QAFinding {
  source: QASource;
  check_name: QACheckName | string;
  severity: QASeverity;
  message: string;
  evidence: Record<string, unknown>;
}

export interface QAReport {
  findings: QAFinding[];
  blocker_count: number;
  warning_count: number;
  info_count: number;
  auto_repairs_applied: Array<{ check_name: string; action: string }>;
}

// ────────────────────── Semantic QA (contract only) ───────────

export interface SemanticQAInput {
  evidence_pack: EvidencePackPayload;
  draft: DraftOutput;
}

export type SemanticQAVerdict =
  | { verdict: 'pass' }
  | {
      verdict: 'fail';
      unsupported_claims: string[];
      misleading_interpretations: string[];
      contradictions: string[];
      repetition: string[];
      severe_quality_issues: string[];
    };

// ────────────────────── Pipeline outcome ───────────────────────

export type PipelineOutcome =
  | 'ready_to_publish'
  | 'ready_for_first_paid_run'      // Checkpoint B stops here in fixture mode
  | 'held';

export interface PipelineResult {
  mode: ExecutionMode;
  outcome: PipelineOutcome;
  hold_reasons: string[];
  opportunity: ScoredOpportunity;
  evidence_pack_id: string | null;  // null when the pack was computed in-memory only
  evidence_pack: EvidencePackPayload;
  draft: DraftOutput | null;
  qa: QAReport | null;
  budget_preview: {
    projected_cost_usd: number;
    per_article_cap_usd: number;
    daily_remaining_usd: number;
    monthly_remaining_usd: number;
  };
}
