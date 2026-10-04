import 'server-only';

// Revenue-side read queries. All amounts in *minor units* (pence for
// GBP, cents for USD) — the UI converts at the edge. Nothing here
// infers a conversion from a click; the three signals are read from
// three different tables and reported separately.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RevenueSource {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  default_currency: string;
  is_active: boolean;
}

export async function listRevenueSources(sb: SupabaseClient): Promise<RevenueSource[]> {
  const { data, error } = await sb
    .from('network_revenue_sources')
    .select('id, slug, display_name, kind, default_currency, is_active')
    .order('kind', { ascending: true })
    .order('display_name', { ascending: true });
  if (error) throw new Error(`[revenue] listRevenueSources: ${error.message}`);
  return (data ?? []) as RevenueSource[];
}

export interface RevenueEventRow {
  id: string;
  source_id: string;
  site_id: string | null;
  sponsorship_id: string | null;
  partner_id: string | null;
  event_kind: 'revenue' | 'refund' | 'adjustment' | 'reversal';
  occurred_on: string;
  amount_minor: number;
  currency: string;
  description: string | null;
  external_ref: string | null;
  recorded_at: string;
  network_revenue_sources: { slug: string; display_name: string; kind: string } | null;
  network_sites: { slug: string; name: string } | null;
}

export async function listRecentRevenueEvents(
  sb: SupabaseClient,
  limit = 30,
): Promise<RevenueEventRow[]> {
  const { data, error } = await sb
    .from('network_revenue_events')
    .select(
      'id, source_id, site_id, sponsorship_id, partner_id, event_kind, occurred_on, amount_minor, currency, description, external_ref, recorded_at, network_revenue_sources(slug, display_name, kind), network_sites(slug, name)',
    )
    .order('occurred_on', { ascending: false })
    .order('recorded_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[revenue] listRecentRevenueEvents: ${error.message}`);
  return (data ?? []) as unknown as RevenueEventRow[];
}

export interface TotalsByCurrency {
  currency: string;
  net_minor: number;
  gross_minor: number;
  refunds_minor: number;
  event_count: number;
}

export async function totalsSince(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<TotalsByCurrency[]> {
  // Group in SQL via rpc would be cleaner; for Phase 5 we aggregate
  // in-memory because event volume is tiny for the foreseeable future.
  const { data, error } = await sb
    .from('network_revenue_events')
    .select('amount_minor, currency, event_kind')
    .gte('occurred_on', sinceDate);
  if (error) throw new Error(`[revenue] totalsSince: ${error.message}`);
  const rows = (data ?? []) as Array<{ amount_minor: number; currency: string; event_kind: string }>;
  const byCurrency = new Map<string, TotalsByCurrency>();
  for (const r of rows) {
    const bucket = byCurrency.get(r.currency) ?? {
      currency: r.currency, net_minor: 0, gross_minor: 0, refunds_minor: 0, event_count: 0,
    };
    bucket.event_count += 1;
    bucket.net_minor += r.amount_minor;
    if (r.event_kind === 'refund' || r.event_kind === 'reversal') {
      bucket.refunds_minor += r.amount_minor;
    } else {
      bucket.gross_minor += r.amount_minor;
    }
    byCurrency.set(r.currency, bucket);
  }
  return Array.from(byCurrency.values()).sort((a, b) => b.net_minor - a.net_minor);
}

export interface ChannelRevenueRow {
  source_slug: string;
  source_name: string;
  kind: string;
  currency: string;
  net_minor: number;
  event_count: number;
}

export async function revenueByChannelSince(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<ChannelRevenueRow[]> {
  const { data, error } = await sb
    .from('network_revenue_events')
    .select(
      'amount_minor, currency, source_id, network_revenue_sources(slug, display_name, kind)',
    )
    .gte('occurred_on', sinceDate);
  if (error) throw new Error(`[revenue] revenueByChannelSince: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    amount_minor: number; currency: string;
    network_revenue_sources: { slug: string; display_name: string; kind: string } | null;
  }>;
  const bucket = new Map<string, ChannelRevenueRow>();
  for (const r of rows) {
    const src = r.network_revenue_sources;
    if (!src) continue;
    const key = `${src.slug}:${r.currency}`;
    const b = bucket.get(key) ?? {
      source_slug: src.slug, source_name: src.display_name, kind: src.kind,
      currency: r.currency, net_minor: 0, event_count: 0,
    };
    b.net_minor += r.amount_minor;
    b.event_count += 1;
    bucket.set(key, b);
  }
  return Array.from(bucket.values()).sort((a, b) => b.net_minor - a.net_minor);
}

export interface SiteRevenueRow {
  site_id: string | null;
  site_slug: string | null;
  site_name: string | null;
  currency: string;
  net_minor: number;
  event_count: number;
}

export async function revenueBySiteSince(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<SiteRevenueRow[]> {
  const { data, error } = await sb
    .from('network_revenue_events')
    .select('amount_minor, currency, site_id, network_sites(slug, name)')
    .gte('occurred_on', sinceDate);
  if (error) throw new Error(`[revenue] revenueBySiteSince: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    amount_minor: number; currency: string; site_id: string | null;
    network_sites: { slug: string; name: string } | null;
  }>;
  const bucket = new Map<string, SiteRevenueRow>();
  for (const r of rows) {
    const key = `${r.site_id ?? 'network'}:${r.currency}`;
    const b = bucket.get(key) ?? {
      site_id: r.site_id,
      site_slug: r.network_sites?.slug ?? null,
      site_name: r.network_sites?.name ?? null,
      currency: r.currency, net_minor: 0, event_count: 0,
    };
    b.net_minor += r.amount_minor;
    b.event_count += 1;
    bucket.set(key, b);
  }
  return Array.from(bucket.values()).sort((a, b) => b.net_minor - a.net_minor);
}

export interface ClickTotalsRow {
  site_id: string;
  site_slug: string | null;
  site_name: string | null;
  clicks: number;
}

export async function clicksBySiteSince(
  sb: SupabaseClient,
  sinceIso: string,
): Promise<ClickTotalsRow[]> {
  const { data, error } = await sb
    .from('network_affiliate_clicks')
    .select('site_id, network_sites(slug, name)')
    .gte('occurred_at', sinceIso);
  if (error) throw new Error(`[revenue] clicksBySiteSince: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    site_id: string; network_sites: { slug: string; name: string } | null;
  }>;
  const bucket = new Map<string, ClickTotalsRow>();
  for (const r of rows) {
    const b = bucket.get(r.site_id) ?? {
      site_id: r.site_id,
      site_slug: r.network_sites?.slug ?? null,
      site_name: r.network_sites?.name ?? null,
      clicks: 0,
    };
    b.clicks += 1;
    bucket.set(r.site_id, b);
  }
  return Array.from(bucket.values()).sort((a, b) => b.clicks - a.clicks);
}

export interface ConversionTotalsRow {
  source_id: string;
  source_slug: string;
  conversions: number;
  amount_minor: number;
  currency: string;
}

export interface WindowTotals {
  currency: string;
  booked_minor: number;      // confirmed revenue events, excluding pending/reversal
  pending_minor: number;     // conversion rows not yet reconciled to a revenue_event
  refunds_minor: number;     // refunds + reversals
  event_count: number;
}

export async function windowBookedTotals(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<WindowTotals[]> {
  const { data, error } = await sb.from('network_revenue_events')
    .select('amount_minor, currency, event_kind, source_detail')
    .gte('occurred_on', sinceDate);
  if (error) throw new Error(`[revenue] windowBookedTotals: ${error.message}`);
  const rows = (data ?? []) as Array<{ amount_minor: number; currency: string; event_kind: string; source_detail: Record<string, unknown> | null }>;
  const b = new Map<string, WindowTotals>();
  for (const r of rows) {
    const bucket = b.get(r.currency) ?? { currency: r.currency, booked_minor: 0, pending_minor: 0, refunds_minor: 0, event_count: 0 };
    bucket.event_count += 1;
    if (r.event_kind === 'refund' || r.event_kind === 'reversal') {
      bucket.refunds_minor += r.amount_minor;
    } else if ((r.source_detail?.status as string | undefined) === 'pending') {
      bucket.pending_minor += r.amount_minor;
    } else {
      bucket.booked_minor += r.amount_minor;
    }
    b.set(r.currency, bucket);
  }
  return Array.from(b.values()).sort((a, b) => b.booked_minor - a.booked_minor);
}

export interface SponsorMrr {
  currency: string;
  monthly_minor: number;
  active_deals: number;
}

export async function sponsorMrr(sb: SupabaseClient): Promise<SponsorMrr[]> {
  const { data, error } = await sb.from('network_sponsorships')
    .select('status, total_value_minor, term_months, billing_cadence, currency')
    .in('status', ['active', 'renewing']);
  if (error) throw new Error(`[revenue] sponsorMrr: ${error.message}`);
  const rows = (data ?? []) as Array<{ status: string; total_value_minor: number; term_months: number | null; billing_cadence: string; currency: string }>;
  const b = new Map<string, SponsorMrr>();
  for (const r of rows) {
    let monthly = 0;
    if (r.billing_cadence === 'monthly' && r.term_months && r.term_months > 0) {
      monthly = Math.round(r.total_value_minor / r.term_months);
    } else if (r.billing_cadence === 'annually' && r.total_value_minor) {
      monthly = Math.round(r.total_value_minor / 12);
    } else if (r.billing_cadence === 'quarterly' && r.total_value_minor) {
      monthly = Math.round(r.total_value_minor / 3);
    } else if (r.term_months && r.term_months > 0) {
      monthly = Math.round(r.total_value_minor / r.term_months);
    }
    const bucket = b.get(r.currency) ?? { currency: r.currency, monthly_minor: 0, active_deals: 0 };
    bucket.monthly_minor += monthly;
    bucket.active_deals += 1;
    b.set(r.currency, bucket);
  }
  return Array.from(b.values());
}

export interface PipelineTotals {
  currency: string;
  value_minor: number;      // contracted + proposed deals (not booked)
  deal_count: number;
  by_status: Record<string, { value_minor: number; count: number }>;
}

export async function pipelineTotals(sb: SupabaseClient): Promise<PipelineTotals[]> {
  const { data, error } = await sb.from('network_sponsorships')
    .select('status, total_value_minor, currency');
  if (error) throw new Error(`[revenue] pipelineTotals: ${error.message}`);
  const rows = (data ?? []) as Array<{ status: string; total_value_minor: number; currency: string }>;
  const b = new Map<string, PipelineTotals>();
  for (const r of rows) {
    const bucket = b.get(r.currency) ?? { currency: r.currency, value_minor: 0, deal_count: 0, by_status: {} };
    bucket.deal_count += 1;
    bucket.value_minor += r.total_value_minor;
    const s = bucket.by_status[r.status] ?? { value_minor: 0, count: 0 };
    s.value_minor += r.total_value_minor;
    s.count += 1;
    bucket.by_status[r.status] = s;
    b.set(r.currency, bucket);
  }
  return Array.from(b.values()).sort((a, b) => b.value_minor - a.value_minor);
}

export async function conversionsBySourceSince(
  sb: SupabaseClient,
  sinceDate: string,
): Promise<ConversionTotalsRow[]> {
  const { data, error } = await sb
    .from('network_affiliate_conversions')
    .select('source_id, amount_minor, currency, network_revenue_sources(slug)')
    .gte('occurred_on', sinceDate);
  if (error) throw new Error(`[revenue] conversionsBySourceSince: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{
    source_id: string; amount_minor: number; currency: string;
    network_revenue_sources: { slug: string } | null;
  }>;
  const bucket = new Map<string, ConversionTotalsRow>();
  for (const r of rows) {
    const key = `${r.source_id}:${r.currency}`;
    const b = bucket.get(key) ?? {
      source_id: r.source_id, source_slug: r.network_revenue_sources?.slug ?? '—',
      conversions: 0, amount_minor: 0, currency: r.currency,
    };
    b.conversions += 1;
    b.amount_minor += r.amount_minor;
    bucket.set(key, b);
  }
  return Array.from(bucket.values()).sort((a, b) => b.amount_minor - a.amount_minor);
}
