// @collector-network/auth
//
// Shared authentication primitives for every Collector Network site
// that lives inside this monorepo. Every helper is a thin wrapper on
// top of Supabase Auth via @supabase/ssr — the same Supabase project
// that owns the tcg_* tables. No per-site auth users; a single
// canonical identity backs Collections, Watchlists and Decks across
// every game vertical.
//
// Runtime split:
//   - createBrowserSupabase()  — client-component browser client
//   - createServerSupabase()   — RSC / server-action / route handler
//                                client with Next 15 cookie handling
//   - getCurrentUser()         — server helper, tolerant of no session
//   - requireUser(returnTo)    — server helper for protected routes
//                                (redirects to a caller-supplied path)
//   - readMiddlewareSession()  — helper for middleware.ts to refresh
//                                the Supabase session cookie on every
//                                request without importing next/headers
//
// Env vars consumed:
//   SUPABASE_URL, SUPABASE_ANON_KEY
// Server-side only. Never used from browser bundles.

export {
  createBrowserSupabase,
} from './browser';

export {
  createServerSupabase,
  getCurrentUser,
  requireUser,
} from './server';

export { readMiddlewareSession } from './middleware';

export type { CollectorNetworkUser } from './types';

// Slice CN-A — shared customer / membership / consent API.
// Every site (YGOPrices, PokePrices, MTGPrices, One Piece,
// Lorcana) uses the same wrappers so the DB contract stays
// enforced in one place. See docs/network/schema-request-cn-a.md.
export {
  applySignupMarketingConsent,
  buildSignupMetadata,
  COLLECTOR_NETWORK_MARKETING_OPT_IN_KEY,
  COLLECTOR_ORIGIN_SITE_KEY,
  COLLECTOR_SITE_MARKETING_OPT_IN_KEY,
  getCurrentConsentVersion,
  getMarketingConsentEvents,
  getMarketingPreferences,
  getSignupContext,
  getUserSiteMemberships,
  recordOriginFromSignup,
  recordSiteAuthentication,
  recordSiteVisit,
  setNetworkMarketingPreference,
  setSiteMarketingPreference,
} from './customer';
export type {
  ConsentAction,
  ConsentEvent,
  ConsentScope,
  CustomerResult,
  MarketingPreference,
  SignupContext,
  SiteCode,
  SiteMembership,
  UserConsentSource,
} from './customer';
