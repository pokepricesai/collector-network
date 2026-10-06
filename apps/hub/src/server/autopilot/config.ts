import 'server-only';

// Autopilot config reader/writer.
//
// Config is stored in network_autopilot_config as (scope, key, value jsonb).
// Two scopes are supported:
//   - 'global' — network-wide switches and caps
//   - 'site:<slug>' — per-site overrides
//
// Readers are typed per key; adding a new key requires both a seed
// row (migration) and a getter here. The admin settings page writes
// via upsert through updateAutopilotConfig().

import type { SupabaseClient } from '@supabase/supabase-js';

export const AUTOPILOT_SITE_SLUGS = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'] as const;
export type AutopilotSiteSlug = (typeof AUTOPILOT_SITE_SLUGS)[number];

export type ScopeKey = 'global' | `site:${AutopilotSiteSlug}`;

export interface ModelConfig {
  provider: 'anthropic' | string;
  model: string;
  max_output_tokens: number;
}

export interface GlobalConfig {
  autopilot_enabled: boolean;
  auto_publish_enabled: boolean;
  refreshes_enabled: boolean;
  max_articles_per_day: number;
  max_cost_per_article_usd: number;
  daily_article_budget_usd: number;
  monthly_article_budget_usd: number;
  min_opportunity_score: number;
  default_draft_model: ModelConfig;
  fallback_model: ModelConfig;
  semantic_qa_model: ModelConfig;
}

export interface SiteConfig {
  enabled: boolean;
  auto_publish_allowed: boolean;
}

export interface AutopilotSnapshot {
  global: GlobalConfig;
  sites: Record<AutopilotSiteSlug, SiteConfig>;
}

interface ConfigRow {
  scope: string;
  key: string;
  value: unknown;
  description: string | null;
  updated_at: string;
}

const GLOBAL_DEFAULTS: GlobalConfig = {
  autopilot_enabled: false,
  auto_publish_enabled: false,
  refreshes_enabled: true,
  max_articles_per_day: 1,
  max_cost_per_article_usd: 0.13,
  daily_article_budget_usd: 0.5,
  monthly_article_budget_usd: 10,
  min_opportunity_score: 60,
  default_draft_model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', max_output_tokens: 4000 },
  fallback_model:      { provider: 'anthropic', model: 'claude-sonnet-4-6',          max_output_tokens: 4000 },
  semantic_qa_model:   { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', max_output_tokens: 2000 },
};

const SITE_DEFAULTS: SiteConfig = { enabled: false, auto_publish_allowed: false };

function parseModel(v: unknown): ModelConfig {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const provider = typeof o['provider'] === 'string' ? o['provider'] as string : 'anthropic';
    const model = typeof o['model'] === 'string' ? o['model'] as string : 'claude-haiku-4-5-20251001';
    const toks = Number(o['max_output_tokens']);
    return { provider, model, max_output_tokens: Number.isFinite(toks) ? Math.max(1, Math.floor(toks)) : 4000 };
  }
  return { ...GLOBAL_DEFAULTS.default_draft_model };
}

function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
}

function toNumber(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadAutopilotSnapshot(sb: SupabaseClient): Promise<AutopilotSnapshot> {
  const { data, error } = await sb
    .from('network_autopilot_config')
    .select('scope, key, value, description, updated_at');
  if (error) {
    // Fail safe: return defaults (everything off) rather than crashing the admin page.
    return defaultSnapshot();
  }
  const rows = (data ?? []) as ConfigRow[];
  const byScope = new Map<string, Map<string, unknown>>();
  for (const r of rows) {
    const bucket = byScope.get(r.scope) ?? new Map<string, unknown>();
    bucket.set(r.key, r.value);
    byScope.set(r.scope, bucket);
  }
  const g = byScope.get('global') ?? new Map();
  const global: GlobalConfig = {
    autopilot_enabled:          toBool(g.get('autopilot_enabled'),      GLOBAL_DEFAULTS.autopilot_enabled),
    auto_publish_enabled:       toBool(g.get('auto_publish_enabled'),   GLOBAL_DEFAULTS.auto_publish_enabled),
    refreshes_enabled:          toBool(g.get('refreshes_enabled'),      GLOBAL_DEFAULTS.refreshes_enabled),
    max_articles_per_day:       toNumber(g.get('max_articles_per_day'),       GLOBAL_DEFAULTS.max_articles_per_day),
    max_cost_per_article_usd:   toNumber(g.get('max_cost_per_article_usd'),   GLOBAL_DEFAULTS.max_cost_per_article_usd),
    daily_article_budget_usd:   toNumber(g.get('daily_article_budget_usd'),   GLOBAL_DEFAULTS.daily_article_budget_usd),
    monthly_article_budget_usd: toNumber(g.get('monthly_article_budget_usd'), GLOBAL_DEFAULTS.monthly_article_budget_usd),
    min_opportunity_score:      toNumber(g.get('min_opportunity_score'),      GLOBAL_DEFAULTS.min_opportunity_score),
    default_draft_model: parseModel(g.get('default_draft_model')),
    fallback_model:      parseModel(g.get('fallback_model')),
    semantic_qa_model:   parseModel(g.get('semantic_qa_model')),
  };
  const sites = {} as Record<AutopilotSiteSlug, SiteConfig>;
  for (const slug of AUTOPILOT_SITE_SLUGS) {
    const s = byScope.get(`site:${slug}`) ?? new Map();
    sites[slug] = {
      enabled:              toBool(s.get('enabled'),              SITE_DEFAULTS.enabled),
      auto_publish_allowed: toBool(s.get('auto_publish_allowed'), SITE_DEFAULTS.auto_publish_allowed),
    };
  }
  return { global, sites };
}

export async function updateAutopilotConfig(
  sb: SupabaseClient,
  scope: ScopeKey,
  key: string,
  value: unknown,
  actorUserId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb
    .from('network_autopilot_config')
    .upsert({
      scope,
      key,
      value: value as Record<string, unknown>,
      updated_at: new Date().toISOString(),
      updated_by: actorUserId,
    }, { onConflict: 'scope,key' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function defaultSnapshot(): AutopilotSnapshot {
  const sites = {} as Record<AutopilotSiteSlug, SiteConfig>;
  for (const slug of AUTOPILOT_SITE_SLUGS) sites[slug] = { ...SITE_DEFAULTS };
  return { global: { ...GLOBAL_DEFAULTS }, sites };
}
