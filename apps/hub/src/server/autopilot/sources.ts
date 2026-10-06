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
  notes: string | null;
  updated_at: string;
}

export async function listSources(sb: SupabaseClient, siteSlug: AutopilotSiteSlug): Promise<SourceRow[]> {
  const { data } = await sb
    .from('network_autopilot_sources')
    .select('id, site_slug, name, domain, category, tier, trust_level, official, discovery_method, feed_url, listing_url, content_usage_policy, enabled, last_discovered_at, last_signal_count, notes, updated_at')
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

export async function markSourceDiscovered(sb: SupabaseClient, id: string, signalCount: number): Promise<void> {
  await sb.from('network_autopilot_sources').update({
    last_discovered_at: new Date().toISOString(),
    last_signal_count: signalCount,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}
