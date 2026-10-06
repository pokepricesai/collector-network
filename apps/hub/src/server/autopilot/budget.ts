import 'server-only';

// Autopilot AI budget reservation wrappers.
//
// Four Postgres RPCs do the atomic work (see
// supabase/migrations/20261007000000_autopilot_foundation.sql); this
// module just gives TypeScript callers a typed interface.
//
// Usage pattern during a future autopilot run (NOT in checkpoint A):
//
//   const r = await reserveAiBudget(sb, { runId, siteId, ideaId, estimatedUsd });
//   if (!r.reserved) return { held: true, reason: r.reason };
//   try {
//     const actual = await runGeneration(...);
//     await consumeAiBudget(sb, { reservationId: r.reservationId!, articleId, actualUsd: actual });
//   } catch (err) {
//     await failAiBudget(sb, { reservationId: r.reservationId!, reason: String(err) });
//     throw err;
//   }
//
// If the operation is cancelled before any AI spend occurs, call
// releaseAiBudget to free the reserved amount back into the pool.

import type { SupabaseClient } from '@supabase/supabase-js';

export type BudgetReservationStatus = 'reserved' | 'consumed' | 'released' | 'failed';
export type BudgetDenialReason =
  | 'invalid_estimate'
  | 'config_missing'
  | 'estimate_exceeds_per_article_cap'
  | 'daily_budget_exceeded'
  | 'monthly_budget_exceeded';

export interface ReserveInput {
  runId: string;
  siteId: string | null;
  ideaId: string | null;
  estimatedUsd: number;
}
export interface ReserveOutput {
  reservationId: string | null;
  reserved: boolean;
  reason: BudgetDenialReason | null;
}

export async function reserveAiBudget(sb: SupabaseClient, input: ReserveInput): Promise<ReserveOutput> {
  const { data, error } = await sb.rpc('network_reserve_ai_budget', {
    p_autopilot_run_id: input.runId,
    p_site_id: input.siteId,
    p_idea_id: input.ideaId,
    p_estimated_usd: input.estimatedUsd,
  });
  if (error) {
    return { reservationId: null, reserved: false, reason: 'config_missing' };
  }
  const rows = (data ?? []) as Array<{ reservation_id: string | null; reserved: boolean; reason: string | null }>;
  const row = rows[0];
  if (!row) return { reservationId: null, reserved: false, reason: 'config_missing' };
  return {
    reservationId: row.reservation_id,
    reserved: row.reserved,
    reason: (row.reason as BudgetDenialReason | null) ?? null,
  };
}

export async function consumeAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; articleId: string | null; actualUsd: number },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_consume_ai_budget', {
    p_reservation_id: input.reservationId,
    p_article_id: input.articleId,
    p_actual_usd: input.actualUsd,
  });
  if (error) return false;
  return Boolean(data);
}

export async function releaseAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; reason: string },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_release_ai_budget', {
    p_reservation_id: input.reservationId,
    p_reason: input.reason,
  });
  if (error) return false;
  return Boolean(data);
}

export async function failAiBudget(
  sb: SupabaseClient,
  input: { reservationId: string; reason: string },
): Promise<boolean> {
  const { data, error } = await sb.rpc('network_fail_ai_budget', {
    p_reservation_id: input.reservationId,
    p_reason: input.reason,
  });
  if (error) return false;
  return Boolean(data);
}

export interface BudgetSnapshot {
  spent_today_usd: number;
  spent_month_usd: number;
  reservations_today: number;
  reservations_month: number;
}

export async function loadBudgetSnapshot(sb: SupabaseClient): Promise<BudgetSnapshot> {
  // One round-trip, two counts. We sum coalesce(actual, estimated)
  // across reserved + consumed rows so the display matches the RPC's
  // own notion of "committed spend".
  const { data } = await sb
    .from('network_ai_budget_reservations')
    .select('status, estimated_cost_usd, actual_cost_usd, created_at')
    .in('status', ['reserved', 'consumed'])
    .gte('created_at', monthStartIso())
    .limit(5_000);

  const rows = (data ?? []) as Array<{ status: string; estimated_cost_usd: number; actual_cost_usd: number | null; created_at: string }>;
  const todayStart = dayStartIso();
  let spentToday = 0, spentMonth = 0, countToday = 0, countMonth = 0;
  for (const r of rows) {
    const effective = r.actual_cost_usd ?? r.estimated_cost_usd ?? 0;
    spentMonth += effective;
    countMonth += 1;
    if (r.created_at >= todayStart) {
      spentToday += effective;
      countToday += 1;
    }
  }
  return {
    spent_today_usd: spentToday,
    spent_month_usd: spentMonth,
    reservations_today: countToday,
    reservations_month: countMonth,
  };
}

function dayStartIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}
function monthStartIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
