import 'server-only';

// CN-06A reads: vendor categories, offer catalogue, templates,
// per-partner CN-06A fields, scoring view, first-wave list.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface VendorCategory {
  code: string;
  display_name: string;
  description: string;
  target_customer: string;
  why_tcg_audience: string;
  default_relevant_tcgs: string[];
  intro_price_minor: number;
  intro_price_currency: string;
  premium_price_minor: number | null;
  is_active: boolean;
  sort_order: number;
}

export async function listVendorCategories(sb: SupabaseClient): Promise<VendorCategory[]> {
  const { data, error } = await sb.from('crm_vendor_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`[cn06a] categories: ${error.message}`);
  return (data ?? []) as VendorCategory[];
}

export interface VendorOffer {
  id: string;
  category_code: string;
  slug: string;
  display_name: string;
  description: string;
  placement_sites: string[];
  price_minor: number;
  price_currency: string;
  term_months: number;
  tier: 'entry' | 'standard' | 'premium';
  is_live_capability: boolean;
  development_notes: string | null;
  is_active: boolean;
}

export async function listVendorOffers(sb: SupabaseClient, categoryCode?: string): Promise<VendorOffer[]> {
  let q = sb.from('crm_vendor_offers')
    .select('*')
    .eq('is_active', true)
    .order('category_code', { ascending: true })
    .order('price_minor', { ascending: true });
  if (categoryCode) q = q.eq('category_code', categoryCode);
  const { data, error } = await q;
  if (error) throw new Error(`[cn06a] offers: ${error.message}`);
  return (data ?? []) as VendorOffer[];
}

export interface OutreachTemplate {
  id: string;
  category_code: string | null;
  slug: string;
  subject_line: string;
  body_markdown: string;
  variables: string[];
  is_active: boolean;
  notes: string | null;
}

export async function listOutreachTemplates(sb: SupabaseClient, categoryCode?: string | null): Promise<OutreachTemplate[]> {
  let q = sb.from('crm_outreach_templates').select('*').eq('is_active', true).order('slug', { ascending: true });
  if (categoryCode) q = q.eq('category_code', categoryCode);
  const { data, error } = await q;
  if (error) throw new Error(`[cn06a] templates: ${error.message}`);
  return (data ?? []) as OutreachTemplate[];
}

export interface Cn06aPartnerRow {
  id: string;
  slug: string;
  display_name: string;
  website: string | null;
  kind: string;
  status: string;
  priority: number;
  vendor_category: string | null;
  relevant_tcgs: string[];
  us_state: string | null;
  is_us_business: boolean;
  estimated_size: string | null;
  fit_score: number | null;
  fit_score_breakdown: Record<string, number>;
  first_wave: boolean;
  research_confidence: string | null;
  last_researched_at: string | null;
  recommended_offer_id: string | null;
  recommended_price_minor: number | null;
  recommended_currency: string | null;
  next_action: string | null;
  next_action_due: string | null;
  last_contact_at: string | null;
}

export async function listCn06aPartners(
  sb: SupabaseClient,
  filters?: { category?: string; usOnly?: boolean; firstWaveOnly?: boolean; status?: string },
): Promise<Cn06aPartnerRow[]> {
  let q = sb.from('network_partners')
    .select('id, slug, display_name, website, kind, status, priority, vendor_category, relevant_tcgs, us_state, is_us_business, estimated_size, fit_score, fit_score_breakdown, first_wave, research_confidence, last_researched_at, recommended_offer_id, recommended_price_minor, recommended_currency, next_action, next_action_due, last_contact_at')
    .order('fit_score', { ascending: false, nullsFirst: false })
    .order('priority', { ascending: true })
    .order('display_name', { ascending: true });
  if (filters?.category) q = q.eq('vendor_category', filters.category);
  if (filters?.usOnly) q = q.eq('is_us_business', true);
  if (filters?.firstWaveOnly) q = q.eq('first_wave', true);
  if (filters?.status) q = q.eq('status', filters.status);
  const { data, error } = await q;
  if (error) throw new Error(`[cn06a] partners: ${error.message}`);
  return (data ?? []) as unknown as Cn06aPartnerRow[];
}

export interface CategoryCount {
  vendor_category: string;
  count: number;
  avg_fit: number | null;
}

export async function listCategoryCounts(sb: SupabaseClient): Promise<CategoryCount[]> {
  const { data, error } = await sb.from('network_partners')
    .select('vendor_category, fit_score')
    .not('vendor_category', 'is', null);
  if (error) throw new Error(`[cn06a] category counts: ${error.message}`);
  const map = new Map<string, { n: number; sum: number; scored: number }>();
  for (const row of (data ?? []) as Array<{ vendor_category: string; fit_score: number | null }>) {
    const key = row.vendor_category;
    const bucket = map.get(key) ?? { n: 0, sum: 0, scored: 0 };
    bucket.n += 1;
    if (row.fit_score != null) {
      bucket.sum += row.fit_score;
      bucket.scored += 1;
    }
    map.set(key, bucket);
  }
  return Array.from(map.entries()).map(([k, v]) => ({
    vendor_category: k,
    count: v.n,
    avg_fit: v.scored > 0 ? Math.round(v.sum / v.scored) : null,
  })).sort((a, b) => b.count - a.count);
}
