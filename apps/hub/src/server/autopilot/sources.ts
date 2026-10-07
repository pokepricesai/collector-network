import 'server-only';

// Autopilot source registry access.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscoveryMethod, SourceTier } from './types';
import type { AutopilotSiteSlug } from './config';

export interface SourceRow {
  id: string;
  site_slug: AutopilotSiteSlug;
  name: string;
  domain: string;
  category: string | null;
  tier: SourceTier;
  trust_level: 1 | 2 | 3;
  official: boolean;
  discovery_method: DiscoveryMethod;
  feed_url: string | null;
  listing_url: string | null;
  content_usage_policy: string | null;
  enabled: boolean;
  last_discovered_at: string | null;
  last_signal_count: number | null;
  last_signals_retained: number | null;
  last_error_at: string | null;
  last_error: string | null;
  last_successful_fetch_at: string | null;
  requires_game_filter: boolean;
  notes: string | null;
  updated_at: string;
}

export type SourceHealth =
  | 'healthy'
  | 'no_recent_items'
  | 'manual_only'
  | 'fetch_error'
  | 'parse_error'
  | 'filtered_to_zero'
  | 'never_run';

export function classifyHealth(s: SourceRow): SourceHealth {
  if (!s.enabled) return 'manual_only';
  if (s.discovery_method === 'manual') return 'manual_only';
  if (!s.last_discovered_at) return 'never_run';
  if (s.last_error && (!s.last_successful_fetch_at || s.last_error_at! > s.last_successful_fetch_at)) {
    return s.last_error.toLowerCase().includes('parse') ? 'parse_error' : 'fetch_error';
  }
  if ((s.last_signals_retained ?? 0) === 0 && (s.last_signal_count ?? 0) > 0) return 'filtered_to_zero';
  if ((s.last_signal_count ?? 0) === 0) return 'no_recent_items';
  return 'healthy';
}

export async function listSources(sb: SupabaseClient, siteSlug: AutopilotSiteSlug): Promise<SourceRow[]> {
  const { data } = await sb
    .from('network_autopilot_sources')
    .select('id, site_slug, name, domain, category, tier, trust_level, official, discovery_method, feed_url, listing_url, content_usage_policy, enabled, last_discovered_at, last_signal_count, last_signals_retained, last_error_at, last_error, last_successful_fetch_at, requires_game_filter, notes, updated_at')
    .eq('site_slug', siteSlug)
    .order('tier', { ascending: true })
    .order('name', { ascending: true });
  return (data ?? []) as unknown as SourceRow[];
}

export async function listEnabledSources(sb: SupabaseClient, siteSlug: AutopilotSiteSlug): Promise<SourceRow[]> {
  const all = await listSources(sb, siteSlug);
  return all.filter((s) => s.enabled);
}

export async function setSourceEnabled(sb: SupabaseClient, id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const { error } = await sb.from('network_autopilot_sources').update({ enabled, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markSourceDiscovered(
  sb: SupabaseClient,
  id: string,
  signalCount: number,
  retained: number,
): Promise<void> {
  const now = new Date().toISOString();
  await sb.from('network_autopilot_sources').update({
    last_discovered_at: now,
    last_signal_count: signalCount,
    last_signals_retained: retained,
    last_successful_fetch_at: now,
    last_error: null,
    last_error_at: null,
    updated_at: now,
  }).eq('id', id);
}

export async function markSourceError(
  sb: SupabaseClient,
  id: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  await sb.from('network_autopilot_sources').update({
    last_discovered_at: now,
    last_error_at: now,
    last_error: error.slice(0, 500),
    updated_at: now,
  }).eq('id', id);
}
