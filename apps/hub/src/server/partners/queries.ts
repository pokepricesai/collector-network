import 'server-only';

// Partner CRM reads.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PartnerRow {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  status: string;
  website: string | null;
  priority: number;
  next_action: string | null;
  next_action_due: string | null;
  last_contact_at: string | null;
  tags: string[];
  updated_at: string;
}

export async function listPartners(
  sb: SupabaseClient,
  filters?: { status?: string; kind?: string },
): Promise<PartnerRow[]> {
  let q = sb.from('network_partners')
    .select('id, slug, display_name, kind, status, website, priority, next_action, next_action_due, last_contact_at, tags, updated_at')
    .order('priority', { ascending: true })
    .order('updated_at', { ascending: false });
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.kind) q = q.eq('kind', filters.kind);
  const { data, error } = await q;
  if (error) throw new Error(`[partners] list: ${error.message}`);
  return (data ?? []) as PartnerRow[];
}

export interface PartnerDetail extends PartnerRow {
  description: string | null;
  countries: string[];
  intro_source: string | null;
  metadata: Record<string, unknown>;
  owner_user_id: string | null;
  created_at: string;
}

export async function getPartner(sb: SupabaseClient, id: string): Promise<PartnerDetail | null> {
  const { data, error } = await sb.from('network_partners')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[partners] get: ${error.message}`);
  return (data ?? null) as PartnerDetail | null;
}

export interface ContactRow {
  id: string;
  partner_id: string;
  full_name: string;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  twitter: string | null;
  is_primary: boolean;
  notes: string | null;
}

export async function listPartnerContacts(sb: SupabaseClient, partnerId: string): Promise<ContactRow[]> {
  const { data, error } = await sb.from('network_partner_contacts')
    .select('id, partner_id, full_name, role_title, email, phone, linkedin, twitter, is_primary, notes')
    .eq('partner_id', partnerId)
    .order('is_primary', { ascending: false })
    .order('full_name', { ascending: true });
  if (error) throw new Error(`[partners] contacts: ${error.message}`);
  return (data ?? []) as ContactRow[];
}

export interface InteractionRow {
  id: string;
  partner_id: string;
  contact_id: string | null;
  sponsorship_id: string | null;
  kind: string;
  direction: string;
  summary: string;
  detail: string | null;
  external_ref: string | null;
  occurred_at: string;
}

export async function listPartnerInteractions(sb: SupabaseClient, partnerId: string, limit = 50): Promise<InteractionRow[]> {
  const { data, error } = await sb.from('network_partner_interactions')
    .select('id, partner_id, contact_id, sponsorship_id, kind, direction, summary, detail, external_ref, occurred_at')
    .eq('partner_id', partnerId)
    .order('occurred_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`[partners] interactions: ${error.message}`);
  return (data ?? []) as InteractionRow[];
}

export interface OfferRow {
  id: string;
  slug: string;
  display_name: string;
  category: string;
  description: string | null;
  default_scope: string;
  default_unit: string;
  default_price_minor: number | null;
  default_currency: string;
  is_active: boolean;
}

export async function listOffers(sb: SupabaseClient): Promise<OfferRow[]> {
  const { data, error } = await sb.from('network_commercial_offers')
    .select('id, slug, display_name, category, description, default_scope, default_unit, default_price_minor, default_currency, is_active')
    .order('category', { ascending: true })
    .order('display_name', { ascending: true });
  if (error) throw new Error(`[offers] list: ${error.message}`);
  return (data ?? []) as OfferRow[];
}

export interface SponsorshipRow {
  id: string;
  partner_id: string;
  title: string;
  status: string;
  starts_on: string | null;
  ends_on: string | null;
  term_months: number | null;
  total_value_minor: number;
  currency: string;
  billing_cadence: string;
  renewal_reminder_on: string | null;
  network_partners: { slug: string; display_name: string } | null;
}

export async function listSponsorships(
  sb: SupabaseClient,
  filters?: { status?: string; partnerId?: string },
): Promise<SponsorshipRow[]> {
  let q = sb.from('network_sponsorships')
    .select('id, partner_id, title, status, starts_on, ends_on, term_months, total_value_minor, currency, billing_cadence, renewal_reminder_on, network_partners(slug, display_name)')
    .order('status', { ascending: true })
    .order('ends_on', { ascending: false, nullsFirst: false });
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.partnerId) q = q.eq('partner_id', filters.partnerId);
  const { data, error } = await q;
  if (error) throw new Error(`[sponsorships] list: ${error.message}`);
  return (data ?? []) as unknown as SponsorshipRow[];
}

export interface SponsorshipDetail extends SponsorshipRow {
  notes: string | null;
  signed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export async function getSponsorship(sb: SupabaseClient, id: string): Promise<SponsorshipDetail | null> {
  const { data, error } = await sb.from('network_sponsorships')
    .select('*, network_partners(slug, display_name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[sponsorships] get: ${error.message}`);
  return (data ?? null) as unknown as SponsorshipDetail | null;
}

export interface SponsorshipSiteRow {
  sponsorship_id: string;
  site_id: string;
  value_share: number;
  network_sites: { slug: string; name: string } | null;
}

export async function listSponsorshipSites(sb: SupabaseClient, sponsorshipId: string): Promise<SponsorshipSiteRow[]> {
  const { data, error } = await sb.from('network_sponsorship_sites')
    .select('sponsorship_id, site_id, value_share, network_sites(slug, name)')
    .eq('sponsorship_id', sponsorshipId);
  if (error) throw new Error(`[sponsorships] sites: ${error.message}`);
  return (data ?? []) as unknown as SponsorshipSiteRow[];
}

export interface DeliverableRow {
  id: string;
  sponsorship_id: string;
  offer_id: string | null;
  site_id: string | null;
  display_name: string;
  category: string;
  quantity: number;
  placement_hint: string | null;
  status: string;
  live_from: string | null;
  live_until: string | null;
  evidence_url: string | null;
  notes: string | null;
  network_sites: { slug: string; name: string } | null;
}

export async function listDeliverables(sb: SupabaseClient, sponsorshipId: string): Promise<DeliverableRow[]> {
  const { data, error } = await sb.from('network_sponsorship_deliverables')
    .select('id, sponsorship_id, offer_id, site_id, display_name, category, quantity, placement_hint, status, live_from, live_until, evidence_url, notes, network_sites(slug, name)')
    .eq('sponsorship_id', sponsorshipId)
    .order('status', { ascending: true });
  if (error) throw new Error(`[sponsorships] deliverables: ${error.message}`);
  return (data ?? []) as unknown as DeliverableRow[];
}

export interface SponsorshipRevenueTotals {
  booked_minor: number;
  currency: string;
  event_count: number;
}

export async function sponsorshipRevenueTotals(sb: SupabaseClient, sponsorshipId: string): Promise<SponsorshipRevenueTotals[]> {
  const { data, error } = await sb.from('network_revenue_events')
    .select('amount_minor, currency')
    .eq('sponsorship_id', sponsorshipId);
  if (error) throw new Error(`[sponsorships] revenue: ${error.message}`);
  const rows = (data ?? []) as Array<{ amount_minor: number; currency: string }>;
  const b = new Map<string, SponsorshipRevenueTotals>();
  for (const r of rows) {
    const x = b.get(r.currency) ?? { booked_minor: 0, currency: r.currency, event_count: 0 };
    x.booked_minor += r.amount_minor;
    x.event_count += 1;
    b.set(r.currency, x);
  }
  return Array.from(b.values());
}
