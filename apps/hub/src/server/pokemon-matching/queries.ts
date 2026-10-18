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

export type PricingEligibility = 'bulk_safe' | 'market_only' | 'identity_only' | 'not_eligible' | 'uncertain';

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
  pricing_eligibility: PricingEligibility | null;
  commercial_rank: number | null;
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
  by_pricing_eligibility: Record<PricingEligibility, number>;
  bulk_safe_pending: number;
  market_only_pending: number;
  identity_only_pending: number;
  with_tcg_price_snapshot: number;
  activation_eligible: number;
}

export async function fetchStatusCounts(sb: SupabaseClient): Promise<StatusCounts> {
  // We previously tried to pull every mapping row and count locally, but
  // PostgREST silently caps SELECT at max_rows=1000, so the counts were
  // clamped — this is what produced the "1,000 rows currently…" display
  // bug on the admin page. Fix: ask Postgres for each count directly via
  // HEAD queries, which are bounded + fast and ignore row caps.
  const ELIGIBILITIES = ['bulk_safe', 'market_only', 'identity_only', 'not_eligible', 'uncertain'] as const;
  const REVIEW_STATUSES = ['unmatched', 'pending_review', 'approved', 'rejected', 'no_tcg_equivalent', 'needs_price_verification'] as const;

  const total_q = sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true }).eq('provider', 'tcggraph');

  const eligCounts = ELIGIBILITIES.map(e => ({ eligibility: e, q:
    sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph')
      .eq('pricing_eligibility', e),
  }));
  const eligPendingCounts = ELIGIBILITIES.map(e => ({ eligibility: e, q:
    sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph')
      .eq('review_status', 'pending_review')
      .eq('pricing_eligibility', e),
  }));
  const statusCounts = REVIEW_STATUSES.map(s => ({ status: s, q:
    sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph')
      .eq('review_status', s),
  }));

  const verifiedPendingBulk_q = sb.from('pokemon_tcg_mappings')
    .select('id', { count: 'exact', head: true })
    .eq('provider', 'tcggraph')
    .eq('review_status', 'pending_review')
    .eq('confidence', 'verified');

  const [totalRes, verifiedPendingRes, ...everything] = await Promise.all([
    total_q,
    verifiedPendingBulk_q,
    ...eligCounts.map(e => e.q),
    ...eligPendingCounts.map(e => e.q),
    ...statusCounts.map(s => s.q),
  ]);
  if (totalRes.error) throw new Error(`total count: ${totalRes.error.message}`);
  if (verifiedPendingRes.error) throw new Error(`verified pending: ${verifiedPendingRes.error.message}`);

  const total = totalRes.count ?? 0;
  const verified_pending_bulk = verifiedPendingRes.count ?? 0;

  const nElig = ELIGIBILITIES.length;
  const by_pricing_eligibility: Record<string, number> = {};
  for (let i = 0; i < nElig; i++) {
    const key = ELIGIBILITIES[i] ?? 'uncertain';
    const res = everything[i];
    if (res?.error) throw new Error(`elig count ${key}: ${res.error.message}`);
    by_pricing_eligibility[key] = res?.count ?? 0;
  }

  const eligPendingByKey: Record<string, number> = {};
  for (let i = 0; i < nElig; i++) {
    const key = ELIGIBILITIES[i] ?? 'uncertain';
    const res = everything[nElig + i];
    if (res?.error) throw new Error(`elig pending ${key}: ${res.error.message}`);
    eligPendingByKey[key] = res?.count ?? 0;
  }

  const by_status: Record<string, number> = {};
  for (let i = 0; i < REVIEW_STATUSES.length; i++) {
    const key = REVIEW_STATUSES[i] ?? 'unmatched';
    const res = everything[nElig * 2 + i];
    if (res?.error) throw new Error(`status count ${key}: ${res.error.message}`);
    by_status[key] = res?.count ?? 0;
  }

  return {
    total,
    by_status: by_status as Record<ReviewStatus, number>,
    by_status_confidence: [],         // retained in type for backward compat; unused
    verified_pending_bulk,
    by_pricing_eligibility: by_pricing_eligibility as Record<PricingEligibility, number>,
    bulk_safe_pending:     eligPendingByKey.bulk_safe     ?? 0,
    market_only_pending:   eligPendingByKey.market_only   ?? 0,
    identity_only_pending: eligPendingByKey.identity_only ?? 0,
    with_tcg_price_snapshot: 0,
    activation_eligible: 0,
  };
}

export type FilterPreset =
  | 'none'
  | 'promos'
  | 'japanese'
  | 'vintage'
  | 'unsupported_variants'
  | 'needs_review'
  | 'no_equivalent'
  | 'high_traffic';

export interface ListFilters {
  status?: ReviewStatus | 'all';
  confidence?: Exclude<Confidence, null> | 'all';
  language?: 'en' | 'jp' | 'all';
  pricing_eligibility?: PricingEligibility | 'all';
  preset?: FilterPreset;
  search?: string;
  sort?: 'default' | 'commercial';
  limit?: number;
  offset?: number;
}

export async function listMappings(
  sb: SupabaseClient,
  filters: ListFilters,
): Promise<{ rows: MappingRow[]; total: number }> {
  let q = sb
    .from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_set_name, pp_card_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_language, tcg_name, match_method, confidence, review_status, pricing_eligibility, commercial_rank, reviewer_display, reviewed_at, activation_eligible, last_price_check_passed_at, notes, previous_review_status, updated_at', { count: 'exact' });

  if (filters.sort === 'commercial') {
    q = q.order('commercial_rank', { ascending: true, nullsFirst: false })
         .order('pp_card_slug', { ascending: true });
  } else {
    q = q.order('pp_set_name', { ascending: true })
         .order('pp_card_slug', { ascending: true });
  }

  if (filters.status && filters.status !== 'all') q = q.eq('review_status', filters.status);
  if (filters.confidence && filters.confidence !== 'all') q = q.eq('confidence', filters.confidence);
  if (filters.language && filters.language !== 'all') q = q.eq('pp_language', filters.language);
  if (filters.pricing_eligibility && filters.pricing_eligibility !== 'all') q = q.eq('pricing_eligibility', filters.pricing_eligibility);

  // Presets
  if (filters.preset === 'promos') {
    q = q.or('pp_set_name.ilike.%Promo%,pp_set_name.ilike.%Black Star%,pp_set_name.ilike.%Championship%,pp_set_name.ilike.%McDonald%,pp_set_name.ilike.%Topps%');
  }
  if (filters.preset === 'japanese') q = q.eq('pp_language', 'jp');
  if (filters.preset === 'vintage') {
    q = q.or('pp_set_name.in.("Base Set","Jungle","Fossil","Base Set 2","Team Rocket","Gym Heroes","Gym Challenge","Neo Genesis","Neo Discovery","Neo Revelation","Neo Destiny")');
  }
  if (filters.preset === 'unsupported_variants') {
    q = q.or('pp_card_name.ilike.%[Mirror Holo]%,pp_card_name.ilike.%[Jumbo]%,pp_card_name.ilike.%[Prize Pack]%,pp_card_name.ilike.%[Rainbow Foil]%,pp_card_name.ilike.%[Stamped]%,pp_card_name.ilike.%[Prism]%,pp_card_name.ilike.%[Gold Star]%,pp_card_name.ilike.%[Sparkle]%,pp_card_name.ilike.%[Tekno]%');
  }
  if (filters.preset === 'needs_review') q = q.eq('review_status', 'pending_review');
  if (filters.preset === 'no_equivalent') q = q.eq('review_status', 'no_tcg_equivalent');
  if (filters.preset === 'high_traffic') q = q.not('commercial_rank', 'is', null);

  if (filters.search && filters.search.trim()) {
    const s = filters.search.trim().replace(/,/g, '');
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

export interface IngestionRunRow {
  id: string;
  kind: string;
  pp_language: string | null;
  started_at: string;
  finished_at: string | null;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  credits_spent: number;
  requests_made: number;
  cards_ingested: number;
  prices_market_rows: number;
  prices_graded_rows: number;
  sets_observed: number;
  alerts_opened: number;
  error_message: string | null;
}

export interface IngestionCursorRow {
  provider: string;
  kind: string;
  state: 'idle' | 'running' | 'completed_for_day' | 'failed';
  last_set_code: string | null;
  last_language: string | null;
  cycle_started_at: string | null;
  cycle_completed_at: string | null;
  cycle_credits_spent: number;
  cycle_sets_processed: number;
  cycle_cards_upserted: number;
  updated_at: string;
}

export async function fetchIngestionCursor(sb: SupabaseClient): Promise<IngestionCursorRow | null> {
  const { data, error } = await sb
    .from('pokemon_tcg_ingestion_cursor')
    .select('*')
    .eq('provider', 'tcggraph')
    .eq('kind', 'daily_catalogue')
    .maybeSingle();
  if (error) throw new Error(`cursor: ${error.message}`);
  return (data as IngestionCursorRow | null);
}

export async function fetchFxFreshness(sb: SupabaseClient): Promise<{ as_of: string | null; usd_eur: number | null }> {
  const { data } = await sb.from('pokemon_tcg_fx_rates')
    .select('as_of, rate')
    .eq('base', 'USD').eq('quote', 'EUR')
    .order('as_of', { ascending: false })
    .limit(1).maybeSingle();
  if (!data) return { as_of: null, usd_eur: null };
  return { as_of: (data as any).as_of, usd_eur: Number((data as any).rate) };
}

export async function fetchPromoProposalCount(sb: SupabaseClient): Promise<{ proposed: number; approved: number }> {
  const [p, a] = await Promise.all([
    sb.from('pokemon_tcg_promo_set_proposals').select('id', { count: 'exact', head: true }).eq('review_state', 'proposed'),
    sb.from('pokemon_tcg_promo_set_proposals').select('id', { count: 'exact', head: true }).eq('review_state', 'approved'),
  ]);
  return { proposed: p.count ?? 0, approved: a.count ?? 0 };
}

export async function listIngestionRuns(sb: SupabaseClient, limit = 10): Promise<IngestionRunRow[]> {
  const { data, error } = await sb
    .from('pokemon_tcg_ingestion_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`ingestion runs: ${error.message}`);
  return (data as IngestionRunRow[]) || [];
}

export interface SetAlertRow {
  id: string;
  kind: string;
  tcg_set_code: string;
  tcg_set_name: string | null;
  tcg_language: string | null;
  payload: Record<string, unknown>;
  first_seen_at: string;
  acknowledged_at: string | null;
}

export async function listOpenSetAlerts(sb: SupabaseClient, limit = 25): Promise<SetAlertRow[]> {
  const { data, error } = await sb
    .from('pokemon_tcg_set_alerts')
    .select('id, kind, tcg_set_code, tcg_set_name, tcg_language, payload, first_seen_at, acknowledged_at')
    .is('acknowledged_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`set alerts: ${error.message}`);
  return (data as SetAlertRow[]) || [];
}

export interface DataHealthCounts {
  provider_cards: number;
  prices_market: number;
  prices_graded: number;
  mapped_with_provider_price: number;
  bulk_safe_with_provider_price: number;
  open_set_alerts: number;
}

export async function fetchDataHealthCounts(sb: SupabaseClient): Promise<DataHealthCounts> {
  const [pcN, mkN, gdN, openAlerts, mappedPriced, bulkPriced] = await Promise.all([
    sb.from('pokemon_tcg_provider_cards').select('id', { count: 'exact', head: true }).eq('provider', 'tcggraph'),
    sb.from('pokemon_tcg_prices_market').select('id', { count: 'exact', head: true }).eq('provider', 'tcggraph'),
    sb.from('pokemon_tcg_prices_graded').select('id', { count: 'exact', head: true }).eq('provider', 'tcggraph'),
    sb.from('pokemon_tcg_set_alerts').select('id', { count: 'exact', head: true }).is('acknowledged_at', null),
    // Mapped rows pointing to a TCG card that has at least one provider price row:
    // Approximation: count mappings with tcg_card_id not null AND confidence verified.
    // The actual price-present count comes from a view we'd add later; this is a floor.
    sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph').eq('confidence', 'verified').not('tcg_card_id', 'is', null),
    sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph').eq('pricing_eligibility', 'bulk_safe').not('tcg_card_id', 'is', null),
  ]);
  if (pcN.error) throw new Error(`provider cards: ${pcN.error.message}`);
  return {
    provider_cards: pcN.count ?? 0,
    prices_market: mkN.count ?? 0,
    prices_graded: gdN.count ?? 0,
    mapped_with_provider_price: mappedPriced.count ?? 0,
    bulk_safe_with_provider_price: bulkPriced.count ?? 0,
    open_set_alerts: openAlerts.count ?? 0,
  };
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
