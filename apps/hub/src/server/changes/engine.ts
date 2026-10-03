import 'server-only';

// SEO change tracker server module.
//
// Manual logging only in Phase 2 — Luke (and later AI) record SEO
// changes here. The engine also exposes before/after performance
// via the SQL function network_seo_change_performance(id).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SeoChangeRow {
  id: string;
  site_id: string;
  change_type: string;
  title: string;
  description: string | null;
  url_pattern: string | null;
  url: string | null;
  old_value: string | null;
  new_value: string | null;
  commit_sha: string | null;
  source: string;
  actor: string | null;
  actor_user_id: string | null;
  started_at: string;
  deployed_at: string | null;
  measurement_start: string | null;
  status: 'proposed' | 'deployed' | 'measuring' | 'completed' | 'rolled_back' | 'cancelled';
  evidence: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SeoChangePerformance {
  before: { clicks: number; impressions: number; position: number | null; ga4Users: number; ga4Sessions: number; windowStart: string; windowEnd: string } | null;
  after:  { clicks: number; impressions: number; position: number | null; ga4Users: number; ga4Sessions: number; windowStart: string; windowEnd: string } | null;
}

export const CHANGE_TYPES = [
  'title',
  'h1',
  'meta_description',
  'canonical',
  'schema',
  'content',
  'internal_links',
  'template',
  'sitemap',
  'robots',
  'other',
] as const;

export async function listChanges(
  sb: SupabaseClient,
  opts: { siteId?: string | null; status?: string | null; limit?: number } = {},
): Promise<SeoChangeRow[]> {
  let q = sb.from('network_seo_changes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.siteId) q = q.eq('site_id', opts.siteId);
  if (opts.status) q = q.eq('status', opts.status);
  const { data, error } = await q;
  if (error) throw new Error(`[changes] list: ${error.message}`);
  return (data ?? []) as unknown as SeoChangeRow[];
}

export async function getChange(sb: SupabaseClient, id: string): Promise<SeoChangeRow | null> {
  const { data, error } = await sb
    .from('network_seo_changes')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[changes] get: ${error.message}`);
  return (data as unknown as SeoChangeRow) ?? null;
}

export async function getChangePerformance(
  sb: SupabaseClient,
  changeId: string,
): Promise<SeoChangePerformance> {
  const { data, error } = await sb.rpc('network_seo_change_performance', {
    p_change_id: changeId,
  });
  if (error) throw new Error(`[changes] perf: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    period: string; clicks: number; impressions: number;
    position_avg: number | null;
    ga4_users: number; ga4_sessions: number;
    window_start: string; window_end: string;
  }>;
  const map: { before?: typeof rows[number]; after?: typeof rows[number] } = {};
  for (const r of rows) { if (r.period === 'before') map.before = r; else if (r.period === 'after') map.after = r; }
  const pack = (r: typeof rows[number] | undefined) => r == null ? null : {
    clicks: Number(r.clicks),
    impressions: Number(r.impressions),
    position: r.position_avg == null ? null : Number(r.position_avg),
    ga4Users: Number(r.ga4_users),
    ga4Sessions: Number(r.ga4_sessions),
    windowStart: r.window_start,
    windowEnd: r.window_end,
  };
  return { before: pack(map.before), after: pack(map.after) };
}
