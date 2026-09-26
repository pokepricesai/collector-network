// Brand registry for transactional auth emails.
//
// One source of truth for which site is currently sending. Every
// per-brand thing an auth email needs (sender display name,
// hostname allowlist, logo URL, primary/accent colour, support
// URL) lives here. No secrets. Sender EMAIL address is env-owned
// via AUTH_EMAIL_FROM_ADDRESS.
//
// Hostname parsing is the ONLY safe way to decide which brand a
// given auth action came from. We NEVER take a brand identifier
// from the payload directly.

export type BrandSiteCode =
  | 'pokemon'
  | 'mtg'
  | 'ygo'
  | 'onepiece'
  | 'lorcana'
  | 'network'; // neutral fallback

export interface Brand {
  siteCode: BrandSiteCode;
  brandName: string;
  senderName: string;
  hostnames: readonly string[];
  logoUrl: string | null;
  primaryColor: string;   // hex, used in headline accent
  accentColor: string;    // hex, used on CTA button
  supportUrl: string;     // brand home; safe fallback for unknown redirect targets
  productBlurb: string;   // used in body copy (e.g. collection, watchlist, decks)
}

// Neutral fallback used when redirect_to hostname does not match
// any known brand. The email still goes out; it just carries
// Collector Network chrome and copy that does not name a specific
// vertical.
export const NEUTRAL_BRAND: Brand = {
  siteCode: 'network',
  brandName: 'Collector Network',
  senderName: 'Collector Network',
  hostnames: [],
  logoUrl: null,
  primaryColor: '#0b0d13',
  accentColor: '#c9a24a',
  supportUrl: 'https://ygoprices.io',
  productBlurb: 'your Collector Network account',
};

export const BRANDS: readonly Brand[] = [
  {
    siteCode: 'ygo',
    brandName: 'YGOPrices',
    senderName: 'YGOPrices',
    hostnames: ['ygoprices.io', 'www.ygoprices.io'],
    logoUrl: 'https://ygoprices.io/ygoprices-logo.png',
    primaryColor: '#0b0d13',
    accentColor: '#c9a24a',
    supportUrl: 'https://ygoprices.io',
    productBlurb: 'your collection, watchlist and decks',
  },
  {
    siteCode: 'mtg',
    brandName: 'MTGPrices',
    senderName: 'MTGPrices',
    hostnames: ['mtgprices.io', 'www.mtgprices.io'],
    logoUrl: null,
    primaryColor: '#0b0d13',
    accentColor: '#c9a24a',
    supportUrl: 'https://mtgprices.io',
    productBlurb: 'your MTGPrices account',
  },
  {
    siteCode: 'pokemon',
    brandName: 'PokePrices',
    senderName: 'PokePrices',
    hostnames: ['pokeprices.io', 'www.pokeprices.io'],
    logoUrl: null,
    primaryColor: '#0b0d13',
    accentColor: '#c9a24a',
    supportUrl: 'https://pokeprices.io',
    productBlurb: 'your PokePrices account',
  },
  // onepiece + lorcana intentionally omitted from the registry
  // until their production hostnames are final. Auth actions from
  // any pre-launch preview domain will fall back to NEUTRAL_BRAND
  // (spec: never guess a brand from an arbitrary redirect URL).
] as const;

// Return the brand whose hostname allowlist matches the given
// hostname (case-insensitive), or the neutral fallback.
export function brandForHostname(hostname: string | null): Brand {
  if (!hostname) return NEUTRAL_BRAND;
  const h = hostname.toLowerCase();
  for (const b of BRANDS) {
    if (b.hostnames.includes(h)) return b;
  }
  return NEUTRAL_BRAND;
}

// Parse a redirect URL, extract the hostname, and resolve the
// brand. Malformed or non-http(s) URLs fall through to neutral.
// This is the ONLY function the request handler should use to
// pick a brand.
export function brandForRedirectUrl(rawUrl: string | null | undefined): Brand {
  if (!rawUrl) return NEUTRAL_BRAND;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NEUTRAL_BRAND;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return NEUTRAL_BRAND;
  }
  return brandForHostname(parsed.hostname);
}

// True if the URL's hostname belongs to a known brand (i.e. is
// safe to include as a Supabase redirect_to target). We validate
// the redirect the user's browser will land on so a malicious
// dashboard-controlled redirect cannot smuggle traffic to a
// third-party site under branded chrome.
export function isKnownRedirectTarget(rawUrl: string | null | undefined): boolean {
  const b = brandForRedirectUrl(rawUrl);
  return b.siteCode !== 'network';
}
