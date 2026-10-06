import 'server-only';

// Semantic QA contract (NOT called in Checkpoint B).
//
// Signature + prompt shape only. The real implementation will:
//   1. Call the configured semantic_qa_model with (evidence, draft).
//   2. Enforce a strict JSON output schema — PASS or FAIL with
//      five structured issue arrays, no essay.
//   3. Reserve + consume budget via the autopilot RPCs.
//   4. Skip itself when the per-article cap would be exceeded (the
//      caller's responsibility).
//
// The function below exists so TypeScript callers can import it
// without triggering a model call. It throws if invoked.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SemanticQAInput, SemanticQAVerdict } from './types';

export const SEMANTIC_QA_SYSTEM_PROMPT = `You are a strict fact-checker for a Yu-Gi-Oh! collecting / price-tracking site.

You will be given:
  * an EVIDENCE_PACK: the frozen deterministic data the article was written from
  * a DRAFT: structured article output

Return STRICT JSON matching exactly this shape:

{"verdict":"pass"}

OR

{
  "verdict":"fail",
  "unsupported_claims":   ["..."],
  "misleading_interpretations": ["..."],
  "contradictions": ["..."],
  "repetition": ["..."],
  "severe_quality_issues": ["..."]
}

Rules:
  * A claim is UNSUPPORTED if it names a card/set/price/percentage/date
    that is not present in EVIDENCE_PACK.market_data, dates, or
    related_pages.
  * A MISLEADING_INTERPRETATION mis-reads a correct number (e.g.
    describes a one-day blip as a sustained trend when the pack shows
    a 7-day window).
  * A CONTRADICTION states something that conflicts with EVIDENCE_PACK.
  * REPETITION flags material that repeats itself across sections.
  * SEVERE_QUALITY_ISSUES are coherence failures (incoherent sentences,
    missing subject, broken HTML).
  * Do NOT emit prose outside the JSON. Do NOT include qualifiers.
  * If the draft is clean, return exactly {"verdict":"pass"}.`;

export async function runSemanticQA(_sb: SupabaseClient, _input: SemanticQAInput): Promise<SemanticQAVerdict> {
  throw new Error('Semantic QA is contract-only in Checkpoint B. Lands with Checkpoint C once Luke approves the first paid run.');
}
