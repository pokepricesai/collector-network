import 'server-only';

// Model-selection abstraction.
//
// Three roles, each configurable via network_autopilot_config:
//   - default_draft_model : the cheap-first model for article drafting
//   - fallback_model      : used only when deterministic QA says the
//                           draft is low-quality AND budget allows
//                           a second attempt
//   - semantic_qa_model   : optional one-shot semantic QA pass
//
// A thin wrapper around the config, kept separate so autopilot code
// never imports a hardcoded model name. Changing the model is an
// admin-config write, not a code change.
//
// Price constants are centralised here so cost estimation and
// post-generation accounting share one source of truth. If a model
// isn't in the table its cost cannot be estimated — the autopilot
// must reject it with a clear error rather than guess.

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAutopilotSnapshot, type ModelConfig } from './config';

export type ModelRole = 'default_draft' | 'fallback' | 'semantic_qa';

// USD per million tokens. Keep in sync with provider pricing.
// Not every model needs cache columns — undefined falls back to
// input/output rates (i.e. no caching discount applied).
export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok?: number;
  cache_write_per_mtok?: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { input_per_mtok: 1.0,   output_per_mtok: 5.0,  cache_read_per_mtok: 0.1,  cache_write_per_mtok: 1.25 },
  'claude-sonnet-4-6':          { input_per_mtok: 3.0,   output_per_mtok: 15.0, cache_read_per_mtok: 0.3,  cache_write_per_mtok: 3.75 },
  'claude-opus-4-7':            { input_per_mtok: 15.0,  output_per_mtok: 75.0, cache_read_per_mtok: 1.5,  cache_write_per_mtok: 18.75 },
};

export interface SelectedModel extends ModelConfig {
  role: ModelRole;
  pricing: ModelPricing;
}

export async function selectModel(sb: SupabaseClient, role: ModelRole): Promise<SelectedModel | { ok: false; reason: string }> {
  const snap = await loadAutopilotSnapshot(sb);
  const cfg =
    role === 'default_draft' ? snap.global.default_draft_model :
    role === 'fallback' ? snap.global.fallback_model :
    snap.global.semantic_qa_model;
  const pricing = MODEL_PRICING[cfg.model];
  if (!pricing) {
    return { ok: false, reason: `No pricing registered for model "${cfg.model}". Add it to MODEL_PRICING in server/autopilot/models.ts.` };
  }
  return { ...cfg, role, pricing };
}

export function isSelectedModel(x: unknown): x is SelectedModel {
  return !!x && typeof x === 'object' && 'role' in (x as object) && 'pricing' in (x as object);
}

export function estimateCostUsd(
  pricing: ModelPricing,
  tokens: { input: number; output: number; cache_read?: number; cache_write?: number },
): number {
  const inp = (tokens.input / 1_000_000) * pricing.input_per_mtok;
  const out = (tokens.output / 1_000_000) * pricing.output_per_mtok;
  const cr = tokens.cache_read && pricing.cache_read_per_mtok
    ? (tokens.cache_read / 1_000_000) * pricing.cache_read_per_mtok : 0;
  const cw = tokens.cache_write && pricing.cache_write_per_mtok
    ? (tokens.cache_write / 1_000_000) * pricing.cache_write_per_mtok : 0;
  return inp + out + cr + cw;
}

// Projected cost before any API call — used by the budget RPC to
// decide whether to reserve. Assumes a typical ~1500-word draft
// (~2500 output tokens) plus the evidence pack as input.
export function projectArticleCost(pricing: ModelPricing, est: { input_tokens: number; output_tokens: number }): number {
  return estimateCostUsd(pricing, { input: est.input_tokens, output: est.output_tokens });
}
