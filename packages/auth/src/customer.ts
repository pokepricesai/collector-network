// @collector-network/auth — customer / membership / consent API.
//
// Thin, typed wrappers around the Slice CN-A SECURITY DEFINER RPCs
// and the `collector_*` read tables. Every function takes a caller-
// supplied Supabase client so the same code works from server
// components (createServerSupabase()) and from client components
// (createBrowserSupabase()).
//
// Design rules:
//   • The user is ALWAYS derived from auth.uid() on the server side
//     of the RPC. Callers never pass a user_id.
//   • Reads go straight through RLS (owner-only SELECT policies).
//   • Writes go through RPCs so the client cannot bypass source-
//     guards, spoof origin, or manufacture consent-source labels
//     like 'admin' or 'brevo_webhook'.
//   • Every wrapper returns a discriminated Result to keep failure
//     handling explicit. Never throws.
//
// See docs/network/schema-request-cn-a.md for the DB contract.

import type { SupabaseClient } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────

export type SiteCode = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana';

export type ConsentScope = 'site' | 'network';
export type ConsentAction = 'opt_in' | 'opt_out';

// Sources allowed from a user session. The DB CHECK on both
// consent tables also permits 'admin' / 'migration' / 'brevo_webhook'
// but the RPCs reject those — future trusted callers write them
// via their own paths.
export type UserConsentSource = 'signup' | 'settings' | 'preference_center';

export interface SiteMembership {
  id: string;
  user_id: string;
  site_code: SiteCode;
  originated_here: boolean;
  first_seen_at: string;
  first_authenticated_at: string | null;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface MarketingPreference {
  id: string;
  user_id: string;
  scope: ConsentScope;
  site_code: SiteCode | null;
  email_opt_in: boolean;
  consented_at: string | null;
  withdrawn_at: string | null;
  consent_source: string; // full six-value enum at DB layer
  consent_text_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsentEvent {
  id: string;
  user_id: string;
  scope: ConsentScope;
  site_code: SiteCode | null;
  action: ConsentAction;
  source: string;
  consent_text_version: string | null;
  occurred_at: string;
}

// Discriminated result. Never throws; every helper returns one of
// these so call-sites are honest about failure paths.
export type CustomerResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'not-authenticated' | 'db-error'; error?: string };

function fail(err: { message?: string; code?: string } | null | undefined): CustomerResult<never> {
  if (!err) return { ok: false, reason: 'db-error', error: 'unknown error' };
  // A missing session surfaces via the RPC's 'not authenticated'
  // raise. Any other error is a genuine DB problem.
  const msg = err.message ?? '';
  if (/not authenticated/i.test(msg)) return { ok: false, reason: 'not-authenticated' };
  return { ok: false, reason: 'db-error', error: msg };
}

// ── Membership writes (RPC) ──────────────────────────────────────

// Upsert membership + bump last_seen_at. Cheap; safe to call on
// every page navigation if desired.
export async function recordSiteVisit(
  supabase: SupabaseClient,
  siteCode: SiteCode,
): Promise<CustomerResult<null>> {
  const { error } = await supabase.rpc('record_site_visit', { p_site_code: siteCode });
  if (error) return fail(error);
  return { ok: true, value: null };
}

// Upsert membership + set first_authenticated_at if null + bump
// last_seen_at. Call this from the site's auth callback after the
// session is established.
export async function recordSiteAuthentication(
  supabase: SupabaseClient,
  siteCode: SiteCode,
): Promise<CustomerResult<null>> {
  const { error } = await supabase.rpc('record_site_authentication', { p_site_code: siteCode });
  if (error) return fail(error);
  return { ok: true, value: null };
}

// Idempotent: only records origin if the user has no origin yet
// AND the user's raw_user_meta_data.collector_origin_site is a
// known site code. Never accepts a site parameter — the origin is
// baked into signup metadata by the site's signup form.
export async function recordOriginFromSignup(
  supabase: SupabaseClient,
): Promise<CustomerResult<null>> {
  const { error } = await supabase.rpc('record_origin_from_signup');
  if (error) return fail(error);
  return { ok: true, value: null };
}

// ── Membership reads (RLS) ───────────────────────────────────────

// All memberships the current user has across the network.
export async function getUserSiteMemberships(
  supabase: SupabaseClient,
): Promise<CustomerResult<SiteMembership[]>> {
  const { data, error } = await supabase
    .from('collector_user_sites')
    .select('*')
    .order('first_seen_at', { ascending: true });
  if (error) return fail(error);
  return { ok: true, value: (data as SiteMembership[] | null) ?? [] };
}

// ── Marketing preference reads (RLS) ─────────────────────────────

export async function getMarketingPreferences(
  supabase: SupabaseClient,
): Promise<CustomerResult<MarketingPreference[]>> {
  const { data, error } = await supabase
    .from('collector_marketing_preferences')
    .select('*');
  if (error) return fail(error);
  return { ok: true, value: (data as MarketingPreference[] | null) ?? [] };
}

// Consent history for the current user. Ordered newest first.
export async function getMarketingConsentEvents(
  supabase: SupabaseClient,
): Promise<CustomerResult<ConsentEvent[]>> {
  const { data, error } = await supabase
    .from('collector_marketing_consent_events')
    .select('*')
    .order('occurred_at', { ascending: false });
  if (error) return fail(error);
  return { ok: true, value: (data as ConsentEvent[] | null) ?? [] };
}

// ── Marketing preference writes (RPC) ────────────────────────────

// Upsert site-scoped preference and append the corresponding event
// atomically. The DB rejects sources other than
// signup / settings / preference_center and requires a non-blank
// text version.
export async function setSiteMarketingPreference(
  supabase: SupabaseClient,
  input: {
    siteCode: SiteCode;
    optIn: boolean;
    source: UserConsentSource;
    textVersion: string;
  },
): Promise<CustomerResult<null>> {
  const { error } = await supabase.rpc('set_site_marketing_preference', {
    p_site_code: input.siteCode,
    p_opt_in: input.optIn,
    p_source: input.source,
    p_text_version: input.textVersion,
  });
  if (error) return fail(error);
  return { ok: true, value: null };
}

// Upsert network-scoped preference and append event. Same source
// and version rules as the site variant.
export async function setNetworkMarketingPreference(
  supabase: SupabaseClient,
  input: {
    optIn: boolean;
    source: UserConsentSource;
    textVersion: string;
  },
): Promise<CustomerResult<null>> {
  const { error } = await supabase.rpc('set_network_marketing_preference', {
    p_opt_in: input.optIn,
    p_source: input.source,
    p_text_version: input.textVersion,
  });
  if (error) return fail(error);
  return { ok: true, value: null };
}

// ── Signup-metadata constant ─────────────────────────────────────
//
// Site frontends pass this key into supabase.auth.signUp options.data
// so record_origin_from_signup() can read it back later.
export const COLLECTOR_ORIGIN_SITE_KEY = 'collector_origin_site';
