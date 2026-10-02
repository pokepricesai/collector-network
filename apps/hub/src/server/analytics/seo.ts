import 'server-only';

// Top-N GSC page / query queries for the SEO command centre.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface SeoListRow {
  siteId: string;
  slug?: string;
  page?: string;
  query?: string;
  clicks: number;
  impressions: number;
  position_avg: number | null;
}

export interface SeoListFilters {
  siteSlug?: string | null;    // null/undefined = network-wide
  start: string;
  end: string;
  orderBy: 'clicks' | 'impressions';
  limit: number;
}

async function siteSlugToId(sb: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await sb
    .from('network_sites')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`[seo] slug→id: ${error.message}`);
  return data ? (data as { id: string }).id : null;
}

async function fetchAgg(
  sb: SupabaseClient,
  table: 'network_gsc_url_daily' | 'network_gsc_query_daily',
  dimensionField: 'page' | 'query',
  filters: SeoListFilters,
): Promise<SeoListRow[]> {
  let siteId: string | null = null;
  if (filters.siteSlug) {
    siteId = await siteSlugToId(sb, filters.siteSlug);
    if (!siteId) return [];
  }
  // Paginate raw rows; aggregate client-side (acceptable at these volumes).
  const rows: Array<{ site_id: string; page?: string; query?: string; clicks: number; impressions: number; position_avg: number | null; date: string }> = [];
  let start = 0;
  const pageSize = 1000;
  for (;;) {
    let q = sb.from(table).select(`site_id,${dimensionField},clicks,impressions,position_avg,date`);
    q = q.gte('date', filters.start).lte('date', filters.end);
    if (siteId) q = q.eq('site_id', siteId);
    q = q.range(start, start + pageSize - 1);
    const { data, error } = await q;
    if (error) throw new Error(`[seo] fetch ${table}: ${error.message}`);
    const batch = (data ?? []) as typeof rows;
    rows.push(...batch);
    if (batch.length < pageSize) break;
    start += pageSize;
    if (start > 500_000) break;
  }
  const acc = new Map<string, { siteId: string; dim: string; clicks: number; impressions: number; posW: number; impW: number }>();
  for (const r of rows) {
    const dim = (r as { page?: string; query?: string })[dimensionField] ?? '';
    if (!dim) continue;
    const k = `${r.site_id}|${dim}`;
    const prev = acc.get(k);
    const posContrib = (r.position_avg ?? 0) * r.impressions;
    if (!prev) {
      acc.set(k, { siteId: r.site_id, dim, clicks: r.clicks, impressions: r.impressions, posW: posContrib, impW: r.impressions });
    } else {
      prev.clicks += r.clicks;
      prev.impressions += r.impressions;
      prev.posW += posContrib;
      prev.impW += r.impressions;
    }
  }
  const out: SeoListRow[] = [...acc.values()].map((r) => ({
    siteId: r.siteId,
    [dimensionField]: r.dim,
    clicks: r.clicks,
    impressions: r.impressions,
    position_avg: r.impW > 0 ? r.posW / r.impW : null,
  } as SeoListRow));
  out.sort((a, b) => (b[filters.orderBy] - a[filters.orderBy]));
  return out.slice(0, filters.limit);
}

export function fetchTopPages(sb: SupabaseClient, filters: SeoListFilters): Promise<SeoListRow[]> {
  return fetchAgg(sb, 'network_gsc_url_daily', 'page', filters);
}

export function fetchTopQueries(sb: SupabaseClient, filters: SeoListFilters): Promise<SeoListRow[]> {
  return fetchAgg(sb, 'network_gsc_query_daily', 'query', filters);
}
