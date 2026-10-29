import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { TcgReleaseRow, Tcg, Language, ProductType, ConfirmationStatus } from './types';

// Read helpers for the release tracker. Admin-scoped only; the
// RLS policies on network_tcg_releases are admin-only.

export interface ListFilters {
  tcg?: Tcg;
  language?: Language;
  product_type?: ProductType;
  statuses?: ConfirmationStatus[];
  from_date?: string;      // inclusive ISO date
  to_date?: string;        // inclusive ISO date
  limit?: number;
}

export async function listReleases(
  sb: SupabaseClient,
  filters: ListFilters = {},
): Promise<TcgReleaseRow[]> {
  let q = sb.from('network_tcg_releases')
    .select('*')
    .order('release_date', { ascending: true, nullsFirst: false })
    .limit(filters.limit ?? 500);
  if (filters.tcg) q = q.eq('tcg', filters.tcg);
  if (filters.language) q = q.eq('language', filters.language);
  if (filters.product_type) q = q.eq('product_type', filters.product_type);
  if (filters.statuses && filters.statuses.length > 0) q = q.in('confirmation_status', filters.statuses);
  if (filters.from_date) q = q.gte('release_date', filters.from_date);
  if (filters.to_date) q = q.lte('release_date', filters.to_date);
  const { data, error } = await q;
  if (error) {
    console.error('[releases/queries] list failed:', error.message);
    return [];
  }
  return (data ?? []) as TcgReleaseRow[];
}

/** Compact view for the Intelligence inbox: next 30 days of
 *  confirmed / announced releases, chronological. Excludes
 *  released / cancelled. */
export async function listUpcomingReleasesCompact(
  sb: SupabaseClient,
  days = 30,
  limit = 10,
): Promise<TcgReleaseRow[]> {
  const today = new Date();
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + days);
  const todayIso = today.toISOString().slice(0, 10);
  const toIso = to.toISOString().slice(0, 10);
  const { data, error } = await sb
    .from('network_tcg_releases')
    .select('*')
    .in('confirmation_status', ['confirmed', 'announced_tbc', 'postponed'])
    .gte('release_date', todayIso)
    .lte('release_date', toIso)
    .order('release_date', { ascending: true })
    .limit(limit);
  if (error) {
    // PostgREST schema-cache miss after a fresh migration is a
    // common failure mode; swallow to keep the inbox online.
    console.error('[releases/queries] upcoming compact failed:', error.message);
    return [];
  }
  return (data ?? []) as TcgReleaseRow[];
}

export async function getRelease(sb: SupabaseClient, id: string): Promise<TcgReleaseRow | null> {
  const { data, error } = await sb
    .from('network_tcg_releases')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[releases/queries] get failed:', error.message);
    return null;
  }
  return (data as TcgReleaseRow | null) ?? null;
}
