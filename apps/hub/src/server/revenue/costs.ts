import 'server-only';

// Cost reads. Three sources, deliberately NOT duplicated into a
// single table at ingest time:
//
//   AI  → network_ai_cost_log.est_cost_usd           (USD, per op)
//   BQ  → network_job_runs.metadata.bq_est_cost_usd  (USD, per job)
//   Ops → network_operating_costs                    (any currency, manual)
//
// All USD cost figures are converted to GBP minor units via a fixed
// per-session rate (default 0.80). We never fabricate an FX feed —
// if the user wants a different rate they override via env.

import type { SupabaseClient } from '@supabase/supabase-js';

const USD_TO_GBP = Number(process.env.USD_TO_GBP ?? '0.80') || 0.80;

export function usdToGbpMinor(usd: number): number {
  return Math.round(usd * USD_TO_GBP * 100);
}

export interface CostRow {
  currency: string;
  ai_minor: number;
  bq_minor: number;
  ops_minor: number;
  total_minor: number;
}

export async function totalCostsSinceGbp(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<CostRow> {
  const sinceIso = new Date(sinceDate + 'T00:00:00Z').toISOString();
  const [aiRes, jobRes, opsRes] = await Promise.all([
    sb.from('network_ai_cost_log').select('est_cost_usd').gte('created_at', sinceIso),
    sb.from('network_job_runs').select('metadata').gte('started_at', sinceIso),
    sb.from('network_operating_costs').select('amount_minor, currency').gte('for_date', sinceDate),
  ]);
  if (aiRes.error) throw new Error(`[costs] ai: ${aiRes.error.message}`);
  if (jobRes.error) throw new Error(`[costs] bq: ${jobRes.error.message}`);
  if (opsRes.error) throw new Error(`[costs] ops: ${opsRes.error.message}`);

  const aiUsd = (aiRes.data ?? []).reduce((s: number, r: { est_cost_usd: number | string }) => s + Number(r.est_cost_usd ?? 0), 0);
  const bqUsd = (jobRes.data ?? []).reduce((s: number, r: { metadata: Record<string, unknown> | null }) => {
    const v = r.metadata && typeof r.metadata === 'object' ? Number((r.metadata as Record<string, unknown>).bq_est_cost_usd ?? 0) : 0;
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);
  const opsMinor = (opsRes.data ?? []).reduce((s: number, r: { amount_minor: number; currency: string }) => {
    // In Phase 5 ops costs are entered in GBP by default. Non-GBP
    // ops are summed into the same bucket after naive FX only when
    // the operator has set USD_TO_GBP; otherwise they are counted
    // at face value.
    if (r.currency === 'USD') return s + Math.round(r.amount_minor * USD_TO_GBP);
    return s + r.amount_minor;
  }, 0);

  const ai_minor = usdToGbpMinor(aiUsd);
  const bq_minor = usdToGbpMinor(bqUsd);
  return {
    currency: 'GBP',
    ai_minor,
    bq_minor,
    ops_minor: opsMinor,
    total_minor: ai_minor + bq_minor + opsMinor,
  };
}

export interface OpsCostRow {
  id: string;
  for_date: string;
  site_id: string | null;
  category: string;
  provider: string | null;
  description: string | null;
  amount_minor: number;
  currency: string;
  external_ref: string | null;
  created_at: string;
  network_sites: { slug: string; name: string } | null;
}

export async function listRecentOpsCosts(sb: SupabaseClient, limit = 50): Promise<OpsCostRow[]> {
  const { data, error } = await sb
    .from('network_operating_costs')
    .select('id, for_date, site_id, category, provider, description, amount_minor, currency, external_ref, created_at, network_sites(slug, name)')
    .order('for_date', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[costs] listRecentOpsCosts: ${error.message}`);
  return (data ?? []) as unknown as OpsCostRow[];
}

export interface AiRecentRow {
  operation: string;
  model: string;
  est_cost_usd: number;
  created_at: string;
}

export async function recentAiCosts(sb: SupabaseClient, limit = 10): Promise<AiRecentRow[]> {
  const { data, error } = await sb
    .from('network_ai_cost_log')
    .select('operation, model, est_cost_usd, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[costs] recentAiCosts: ${error.message}`);
  return (data ?? []) as AiRecentRow[];
}

export interface BqRecentRow {
  job_name: string;
  bq_est_cost_usd: number | null;
  started_at: string;
}

export async function recentBqCosts(sb: SupabaseClient, limit = 10): Promise<BqRecentRow[]> {
  const { data, error } = await sb
    .from('network_job_runs')
    .select('job_name, metadata, started_at')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[costs] recentBqCosts: ${error.message}`);
  const rows = (data ?? []) as Array<{ job_name: string; metadata: Record<string, unknown> | null; started_at: string }>;
  return rows
    .map((r) => ({
      job_name: r.job_name,
      bq_est_cost_usd: r.metadata && typeof r.metadata === 'object'
        ? (Number((r.metadata as Record<string, unknown>).bq_est_cost_usd ?? NaN) || null)
        : null,
      started_at: r.started_at,
    }))
    .filter((r) => r.bq_est_cost_usd != null)
    .slice(0, limit);
}
