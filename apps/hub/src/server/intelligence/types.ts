import 'server-only';

// Shared types for the Intelligence Inbox (Phase 1).
//
// Flow:
//   DATA → RULE → RuleOutput → ScoredItem → Upsert
//     → UI card (ranked by priority_score)
//
// Everything is deterministic. No LLM calls in Phase 1.

export type IntelligenceCategory =
  | 'seo'
  | 'content'
  | 'revenue'
  | 'monetisation'
  | 'technical'
  | 'data_health'
  | 'indexing'
  | 'growth';

export type IntelligenceTone =
  | 'opportunity'
  | 'risk'
  | 'warning'
  | 'positive'
  | 'informational';

export type IntelligenceStatus =
  | 'open'
  | 'task_created'
  | 'snoozed'
  | 'resolved'
  | 'dismissed';

export type SiteSlug = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana';

// Honest expected-upside shape. Ranges when uncertainty is high;
// null when no defensible calculation exists.
export interface ExpectedUpside {
  // Short label operator reads first ("+80 to +180 clicks/month").
  label: string;
  // Optional structured range so UI/analytics can parse it later.
  metric?: 'clicks_per_month' | 'revenue_minor_per_month' | 'impressions_per_month';
  low?: number;
  high?: number;
  currency?: string;
  // Narrative justification; one sentence.
  rationale?: string;
}

// What a rule returns before the engine computes priority + upserts.
export interface RuleOutput {
  source_type: string;         // 'seo' | 'revenue' | 'job' | 'content' | 'traffic'
  source_id: string | null;    // optional upstream record id
  source_key: string;          // deterministic, globally unique
  site_id: string | null;      // null = network-wide
  site_slug: SiteSlug | null;  // for prompt/convenience
  category: IntelligenceCategory;
  type: string;                // e.g. 'striking_distance', 'stale_job'
  tone: IntelligenceTone;
  title: string;
  summary: string;
  recommended_action: string;
  evidence: Record<string, unknown>;
  impact: number;              // 0..100
  confidence: number;          // 0..100
  urgency: number;             // 0..100
  effort: number;              // 0..100
  expected_upside: ExpectedUpside | null;
  metadata?: Record<string, unknown>;
}

export interface ScoredItem extends RuleOutput {
  priority: number;            // 0..100
}

// Rule contract: pure read-only. Receives the Supabase service-role
// client + the current run-at timestamp (so items from the same run
// share last_detected_at and the engine can detect stale items
// deterministically).
export interface IntelligenceRule {
  id: string;                  // short slug for logging
  description: string;
  categoriesScanned: IntelligenceCategory[];  // what the engine considers "scanned" for stale resolution
  run(ctx: RuleContext): Promise<RuleOutput[]>;
}

export interface RuleContext {
  sb: import('@supabase/supabase-js').SupabaseClient;
  runAt: string;               // ISO
  sites: Array<{ id: string; slug: SiteSlug; name: string }>;
  // Convenience: look up by slug.
  siteBySlug: Record<SiteSlug, { id: string; slug: SiteSlug; name: string } | undefined>;
}

// Engine run result for logging.
export interface EngineRunResult {
  run_id: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  rules_executed: number;
  rules_failed: number;
  items_upserted: number;
  items_resolved_auto: number;
  items_reopened: number;
  per_rule: Array<{ rule_id: string; emitted: number; failed: boolean; error?: string }>;
}
