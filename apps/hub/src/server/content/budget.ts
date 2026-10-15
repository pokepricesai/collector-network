import 'server-only';

// CN-04 Slice A rolling 7-day AI budget. $1 ceiling, enforced
// atomically in Postgres via network_reserve_rolling_ai_budget.
//
// Call pattern around every article-related AI operation:
//
//   const r = await reserveArticleAiBudget(sb, { estimatedUsd, ideaId, siteId });
//   if (!r.reserved) throw new Error(`AI budget denied: ${r.reason}`);
//   try {
//     const { usage } = await callAi(...);
//     await consumeArticleAiBudget(sb, { reservationId: r.reservationId!, actualUsd: usage.est_cost_usd });
//     await logAiCost(sb, { operation, usage, ... });
//   } catch (err) {
//     await failArticleAiBudget(sb, { reservationId: r.reservationId!, reason: String(err) });
//     throw err;
//   }

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_LIMIT_USD = 1.00;
const WINDOW_DAYS = 7;

export type BudgetDenialReason =
  | 'invalid_estimate'
  | 'rolling_budget_exceeded'
  | 'rpc_error';

export interface ReserveOutput {
  reservationId: string | null;
  reserved: boolean;
  reason: BudgetDenialReason | null;
}

export async function reserveArticleAiBudget(
  sb: SupabaseClient,
  input: { estimatedUsd: number; ideaId: string | null; siteId: string | null },
): Promise<ReserveOutput> {
  const { data, error } = await sb.rpc('network_reserve_rolling_ai_budget', {
    p_estimated_usd: input.estimatedUsd,
    p_idea_id: input.ideaId,
    p_site_id: input.siteId,
  });
  if (error) {
    console.error(`[budget] reserve rpc: ${error.message}`);
    return { reservationId: null, reserved: false, reason: 'rpc_error' };
  }
  const rows = (data ?? []) as Array<{ reservation_id: string | null; reserved: boolean; reason: string | null }>;
  const row = rows[0];
  if (!row) return { reservationId: null, reserved: false, reason: 'rpc_error' };
  return {
    reservationId: row.reservation_id,
    reserved: row.reserved,
    reason: (row.reason as BudgetDenialReason | null) ?? null,
  };
}

export async function consumeArticleAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; actualUsd: number; articleId?: string | null },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_consume_ai_budget', {
    p_reservation_id: input.reservationId,
    p_article_id: input.articleId ?? null,
    p_actual_usd: input.actualUsd,
  });
  if (error) {
    console.error(`[budget] consume rpc: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

export async function releaseArticleAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; reason: string },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_release_ai_budget', {
    p_reservation_id: input.reservationId,
    p_reason: input.reason,
  });
  if (error) {
    console.error(`[budget] release rpc: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

export async function failArticleAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; reason: string },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_fail_ai_budget', {
    p_reservation_id: input.reservationId,
    p_reason: input.reason,
  });
  if (error) {
    console.error(`[budget] fail rpc: ${error.message}`);
    return false;
  }
  return Boolean(data);
}

export interface RollingBudgetStatus {
  limit_usd: number;
  spent_usd: number;
  reserved_usd: number;
  remaining_usd: number;
  window_days: number;
  ops_in_window: number;
}

export async function getRollingAiBudget(sb: SupabaseClient): Promise<RollingBudgetStatus> {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const [cfgRes, costRes, reservedRes] = await Promise.all([
    sb.from('network_autopilot_config').select('value').eq('scope', 'global').eq('key', 'rolling_7d_budget_usd').maybeSingle(),
    sb.from('network_ai_cost_log').select('est_cost_usd').gte('created_at', sinceIso),
    sb.from('network_ai_budget_reservations').select('estimated_cost_usd').eq('status', 'reserved').gte('created_at', sinceIso),
  ]);

  const rawLimit = (cfgRes.data as { value: unknown } | null)?.value;
  const limit = rawLimit == null ? DEFAULT_LIMIT_USD : Number(rawLimit);

  const costRows = (costRes.data ?? []) as Array<{ est_cost_usd: number | null }>;
  const spent = costRows.reduce((a, r) => a + Number(r.est_cost_usd ?? 0), 0);

  const reservedRows = (reservedRes.data ?? []) as Array<{ estimated_cost_usd: number | null }>;
  const reserved = reservedRows.reduce((a, r) => a + Number(r.estimated_cost_usd ?? 0), 0);

  return {
    limit_usd: limit,
    spent_usd: Number(spent.toFixed(6)),
    reserved_usd: Number(reserved.toFixed(6)),
    remaining_usd: Number(Math.max(0, limit - spent - reserved).toFixed(6)),
    window_days: WINDOW_DAYS,
    ops_in_window: costRows.length,
  };
}

// --- Model config loader ----------------------------------------
//
// Reads network_autopilot_config.default_draft_model. Haiku-first;
// callers that need the fallback (Sonnet) look up 'fallback_model'.

export interface ModelConfig {
  provider: 'anthropic';
  model: string;
  max_output_tokens: number;
}

const HAIKU_FALLBACK: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  max_output_tokens: 4000,
};

export async function loadDraftModel(sb: SupabaseClient): Promise<ModelConfig> {
  const { data } = await sb.from('network_autopilot_config')
    .select('value').eq('scope', 'global').eq('key', 'default_draft_model').maybeSingle();
  const raw = (data as { value: unknown } | null)?.value;
  if (!raw || typeof raw !== 'object') return HAIKU_FALLBACK;
  const r = raw as Partial<ModelConfig>;
  if (!r.model || !r.provider) return HAIKU_FALLBACK;
  return {
    provider: r.provider as 'anthropic',
    model: r.model,
    max_output_tokens: typeof r.max_output_tokens === 'number' ? r.max_output_tokens : HAIKU_FALLBACK.max_output_tokens,
  };
}

// --- Spend estimates --------------------------------------------
//
// Conservative pre-flight estimates used when reserving budget BEFORE
// the AI call. The actual cost is reconciled on consume. These are
// generous ceilings — a brief typically costs ~$0.012 at Haiku-4.5
// pricing, but we reserve $0.03 so we never underestimate.

export const ESTIMATED_COST_USD = {
  brief: 0.03,     // ~5k in + 3k out at Haiku-4.5 ($0.80/$4 per MTok) = ~$0.016; keep 2x headroom
  draft: 0.05,     // ~5k in + 5k out at Haiku-4.5 = ~$0.024; keep 2x headroom
  revision: 0.02,
  summary: 0.01,
} as const;

export type ArticleOperation = keyof typeof ESTIMATED_COST_USD;
