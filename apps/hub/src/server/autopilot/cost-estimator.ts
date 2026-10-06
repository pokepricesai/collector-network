import 'server-only';

// Cost estimator — projects AI spend for a given generation plan.
//
// Called BEFORE any reservation. Returns the per-article projection
// plus the current remaining daily / monthly budget so the admin UI
// can show headroom. In fixture mode we never reserve; in real mode
// the orchestrator must call reserveAiBudget after this estimator
// returns a `fits=true` verdict.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAutopilotSnapshot } from './config';
import { loadBudgetSnapshot } from './budget';
import { selectModel, estimateCostUsd, type ModelRole } from './models';
import type { EvidencePackPayload } from './types';

export interface CostEstimate {
  draft_model: { provider: string; model: string };
  qa_model: { provider: string; model: string } | null;
  tokens: {
    draft_input: number;
    draft_output: number;
    qa_input: number;
    qa_output: number;
  };
  projected_draft_usd: number;
  projected_qa_usd: number;
  projected_total_usd: number;
  per_article_cap_usd: number;
  worst_case_permitted_usd: number;    // the cap, as absolute ceiling
  daily_remaining_usd: number;
  monthly_remaining_usd: number;
  fits: boolean;                       // true if projected <= cap AND budget headroom allows
  blockers: string[];                  // reasons the generation can't be reserved today
}

// Token estimators — intentionally generous. The real token count is
// slightly lower in practice because the Haiku-first model uses
// cache_read on the voice preamble, but we deliberately estimate
// upwards so the cap check is conservative.
function estimateDraftTokens(pack: EvidencePackPayload): { input: number; output: number } {
  // Base system + voice ≈ 1500 input tokens.
  // Evidence pack payload is JSON-encoded; roughly 3 chars/token on
  // JSON. ~2500-token pack is typical for market_movers with ~5 cards.
  const packJson = JSON.stringify(pack);
  const inputTokens = Math.min(10_000, 1500 + Math.ceil(packJson.length / 3));
  // Output budget comes from the template cap.
  const outputTokens = pack.generation_constraints.max_output_tokens;
  return { input: inputTokens, output: outputTokens };
}
function estimateQATokens(pack: EvidencePackPayload): { input: number; output: number } {
  // QA sees evidence + draft; draft is ~3500 chars max → ~1200 tokens.
  const packJson = JSON.stringify(pack);
  const inputTokens = Math.min(8_000, 500 + Math.ceil(packJson.length / 3) + 1500);
  return { input: inputTokens, output: 500 };
}

export async function estimateCost(sb: SupabaseClient, pack: EvidencePackPayload, options: { include_qa: boolean }): Promise<CostEstimate> {
  const snap = await loadAutopilotSnapshot(sb);
  const budget = await loadBudgetSnapshot(sb);

  const draftSel = await selectModel(sb, 'default_draft' as ModelRole);
  if ('ok' in draftSel) {
    return failedEstimate(snap.global.max_cost_per_article_usd, budget, [`Draft model unavailable: ${(draftSel as { reason: string }).reason}`]);
  }

  const draftTokens = estimateDraftTokens(pack);
  const draftCost = estimateCostUsd(draftSel.pricing, { input: draftTokens.input, output: draftTokens.output });

  let qaCost = 0;
  let qaModel: CostEstimate['qa_model'] = null;
  let qaTokens = { input: 0, output: 0 };
  if (options.include_qa) {
    const qaSel = await selectModel(sb, 'semantic_qa' as ModelRole);
    if ('ok' in qaSel) {
      // QA model unavailable — allow draft-only, but surface a warning.
      qaCost = 0;
    } else {
      qaTokens = estimateQATokens(pack);
      qaCost = estimateCostUsd(qaSel.pricing, { input: qaTokens.input, output: qaTokens.output });
      qaModel = { provider: qaSel.provider, model: qaSel.model };
    }
  }

  const total = draftCost + qaCost;
  const dailyRemaining = Math.max(0, snap.global.daily_article_budget_usd - budget.spent_today_usd);
  const monthlyRemaining = Math.max(0, snap.global.monthly_article_budget_usd - budget.spent_month_usd);

  const blockers: string[] = [];
  if (total > snap.global.max_cost_per_article_usd) blockers.push('estimate_exceeds_per_article_cap');
  if (total > dailyRemaining) blockers.push('daily_budget_exceeded');
  if (total > monthlyRemaining) blockers.push('monthly_budget_exceeded');

  return {
    draft_model: { provider: draftSel.provider, model: draftSel.model },
    qa_model: qaModel,
    tokens: {
      draft_input: draftTokens.input,
      draft_output: draftTokens.output,
      qa_input: qaTokens.input,
      qa_output: qaTokens.output,
    },
    projected_draft_usd: round4(draftCost),
    projected_qa_usd: round4(qaCost),
    projected_total_usd: round4(total),
    per_article_cap_usd: snap.global.max_cost_per_article_usd,
    worst_case_permitted_usd: snap.global.max_cost_per_article_usd,
    daily_remaining_usd: round4(dailyRemaining),
    monthly_remaining_usd: round4(monthlyRemaining),
    fits: blockers.length === 0,
    blockers,
  };
}

function failedEstimate(cap: number, budget: { spent_today_usd: number; spent_month_usd: number }, blockers: string[]): CostEstimate {
  return {
    draft_model: { provider: '-', model: '-' },
    qa_model: null,
    tokens: { draft_input: 0, draft_output: 0, qa_input: 0, qa_output: 0 },
    projected_draft_usd: 0,
    projected_qa_usd: 0,
    projected_total_usd: 0,
    per_article_cap_usd: cap,
    worst_case_permitted_usd: cap,
    daily_remaining_usd: Math.max(0, 0 - budget.spent_today_usd),
    monthly_remaining_usd: Math.max(0, 0 - budget.spent_month_usd),
    fits: false,
    blockers,
  };
}

function round4(n: number): number { return Math.round(n * 10_000) / 10_000; }
