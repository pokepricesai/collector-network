import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Queries for the Pokémon → TCGGraph matching workbench. All reads
// go through the admin's session-bound Supabase client; RLS enforces
// admin-only access via public.network_is_admin().

export type ReviewStatus =
  | 'unmatched'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'no_tcg_equivalent'
  | 'needs_price_verification';

export type Confidence = 'verified' | 'high' | 'medium' | 'low' | null;

export interface MappingRow {
  id: string;
  pp_card_slug: string;
  pp_set_name: string | null;
  pp_card_name: string | null;
  pp_language: string | null;
  tcg_card_id: string | null;
  tcg_printing_key: string | null;
  tcg_set_code: string | null;
  tcg_language: string | null;
  tcg_name: string | null;
  match_method: string | null;
  confidence: Confidence;
  review_status: ReviewStatus;
  reviewer_display: string | null;
  reviewed_at: string | null;
  activation_eligible: boolean;
  last_price_check_passed_at: string | null;
  notes: string | null;
  previous_review_status: ReviewStatus | null;
  updated_at: string;
}

export interface CandidateRow {
  id: string;
  pp_card_slug: string;
  tcg_card_id: string;
  tcg_printing_key: string | null;
  tcg_price_card_id: string | null;
  tcg_set_code: string;
  tcg_language: string;
  tcg_collector_num: string | null;
  tcg_name: string | null;
  match_method: string;
  confidence: Exclude<Confidence, null>;
  reasons: string[];
  conflicts: string[];
  snapshot_prices: Record<string, number | null> | null;
  generated_at: string;
}

export interface StatusCounts {
  total: number;
  by_status: Record<ReviewStatus, number>;
  by_status_confidence: Array<{ review_status: ReviewStatus; confidence: Confidence; pp_language: string; n: number }>;
  verified_pending_bulk: number;
  with_tcg_price_snapshot: number;
  activation_eligible: number;
}

export async function fetchStatusCounts(sb: SupabaseClient): Promise<StatusCounts> {
  const { data: v, error } = await sb
    .from('pokemon_tcg_mapping_status_v')
    .select('review_status, confidence, pp_language, n');
  if (error) throw new Error(`status view: ${error.message}`);
  const rows = v || [];
  const by_status: Record<string, number> = {};
  let total = 0;
  let verified_pending_bulk = 0;
  for (const r of rows) {
    const n = Number(r.n);
    total += n;
    by_status[r.review_status] = (by_status[r.review_status] || 0) + n;
    if (r.review_status === 'pending_review' && r.confidence === 'verified') {
      verified_pending_bulk += n;
    }
  }
  // Snapshot counts kept for future expansion
  const activation_eligible = 0;
  const with_tcg_price_snapshot = 0;
  return {
    total,
    by_status: by_status as Record<ReviewStatus, number>,
    by_status_confidence: rows.map(r => ({
      review_status: r.review_status as ReviewStatus,
      confidence: r.confidence as Confidence,
      pp_language: r.pp_language as string,
      n: Number(r.n),
    })),
    verified_pending_bulk,
    with_tcg_price_snapshot,
    activation_eligible,
  };
}

export interface ListFilters {
  status?: ReviewStatus | 'all';
  confidence?: Exclude<Confidence, null> | 'all';
  language?: 'en' | 'jp' | 'all';
  era?: string | 'all';           // not stored yet; filter by set_name regex on client
  search?: string;                // substring on pp_card_name / pp_slug / pp_set_name / tcg_name
  limit?: number;
  offset?: number;
}

export async function listMappings(
  sb: SupabaseClient,
  filters: ListFilters,
): Promise<{ rows: MappingRow[]; total: number }> {
  let q = sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_set_name, pp_card_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_language, tcg_name, match_method, confidence, review_status, reviewer_display, reviewed_at, activation_eligible, last_price_check_passed_at, notes, previous_review_status, updated_at', { count: 'exact' })
    .order('pp_set_name', { ascending: true })
    .order('pp_card_slug', { ascending: true });

  if (filters.status && filters.status !== 'all') q = q.eq('review_status', filters.status);
  if (filters.confidence && filters.confidence !== 'all') q = q.eq('confidence', filters.confidence);
  if (filters.language && filters.language !== 'all') q = q.eq('pp_language', filters.language);

  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim();
    // Search across pp_card_name, pp_set_name, pp_card_slug, tcg_name
    q = q.or(`pp_card_name.ilike.%${s}%,pp_set_name.ilike.%${s}%,pp_card_slug.ilike.%${s}%,tcg_name.ilike.%${s}%`);
  }

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  q = q.range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) throw new Error(`list mappings: ${error.message}`);
  return { rows: (data as MappingRow[]) || [], total: count ?? 0 };
}

export async function getMappingBySlug(
  sb: SupabaseClient,
  pp_card_slug: string,
  provider = 'tcggraph',
): Promise<MappingRow | null> {
  const { data, error } = await sb
    .from('pokemon_tcg_mappings')
    .select('*')
    .eq('provider', provider)
    .eq('pp_card_slug', pp_card_slug)
    .maybeSingle();
  if (error) throw new Error(`get mapping: ${error.message}`);
  return data as MappingRow | null;
}

export async function listCandidatesForSlug(
  sb: SupabaseClient,
  pp_card_slug: string,
  provider = 'tcggraph',
): Promise<CandidateRow[]> {
  const { data, error } = await sb
    .from('pokemon_tcg_mapping_candidates')
    .select('*')
    .eq('provider', provider)
    .eq('pp_card_slug', pp_card_slug)
    .order('confidence', { ascending: false });
  if (error) throw new Error(`candidates: ${error.message}`);
  return (data as CandidateRow[]) || [];
}

export interface PpCardRecord {
  id: number;
  card_slug: string;
  card_name: string;
  set_name: string;
  card_number: string;
  language: string;
  card_url_slug: string | null;
  set_release_date: string | null;
  image_url: string | null;
}

export async function getPpCardBySlug(sb: SupabaseClient, pp_card_slug: string): Promise<PpCardRecord | null> {
  const { data, error } = await sb
    .from('cards')
    .select('id, card_slug, card_name, set_name, card_number, language, card_url_slug, set_release_date, image_url')
    .eq('card_slug', pp_card_slug)
    .maybeSingle();
  if (error) throw new Error(`pp card: ${error.message}`);
  return data as PpCardRecord | null;
}

export interface PpTrendRecord {
  card_slug: string;
  current_raw: number | null;
  current_psa10: number | null;
  current_psa9: number | null;
  as_of: string | null;
}

export async function getPpTrendBySlug(sb: SupabaseClient, pp_card_slug: string): Promise<PpTrendRecord | null> {
  const { data, error } = await sb
    .from('card_trends')
    .select('card_slug, current_raw, current_psa10, current_psa9, as_of')
    .eq('card_slug', pp_card_slug)
    .maybeSingle();
  if (error) throw new Error(`pp trend: ${error.message}`);
  return data as PpTrendRecord | null;
}

export async function listSetAliases(sb: SupabaseClient): Promise<Array<{ id: string; pp_set_name: string; pp_language: string; tcg_set_code: string; tcg_language: string; notes: string | null; created_at: string }>> {
  const { data, error } = await sb
    .from('pokemon_tcg_set_aliases')
    .select('*')
    .order('pp_set_name');
  if (error) throw new Error(`aliases: ${error.message}`);
  return data || [];
}

export async function listRecentAudit(sb: SupabaseClient, limit = 25): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await sb
    .from('pokemon_tcg_mapping_audit')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`audit: ${error.message}`);
  return data || [];
}
