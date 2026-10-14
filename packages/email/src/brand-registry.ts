// Node/Next-compatible mirror of
// supabase/functions/_shared/brand-registry.ts.
//
// Kept intentionally in a separate module so the Deno edge function
// (which uses URL imports) and the Next apps (which use pnpm workspace
// imports) do not share a transitive runtime dependency. Both files
// must stay in sync; adding a site means editing both.

export type BrandSiteCode =
  | 'pokemon'
  | 'mtg'
  | 'ygo'
  | 'onepiece'
  | 'lorcana'
  | 'network';

export interface Brand {
  readonly siteCode: BrandSiteCode;
  readonly brandName: string;
  readonly senderName: string;
  readonly fromAddress: string;
  readonly replyToAddress: string;
  readonly hostnames: readonly string[];
  readonly productUrl: string;
  readonly logoUrl: string | null;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly productBlurb: string;
  readonly productVerb: string;     // e.g. "track"/"watch"/"grade"
  readonly gameLabel: string;       // e.g. "Pokémon"/"Magic"
  readonly officialGameUrl: string | null;
}

const SHARED_DOMAIN = 'collectornetwork.io';
const NETWORK_REPLY_TO = 'support@collectornetwork.io';

export const NEUTRAL_BRAND: Brand = {
  siteCode: 'network',
  brandName: 'Collector Network',
  senderName: 'Collector Network',
  fromAddress: `Collector Network <hello@${SHARED_DOMAIN}>`,
  replyToAddress: NETWORK_REPLY_TO,
  hostnames: [],
  productUrl: 'https://collectornetwork.io',
  logoUrl: null,
  primaryColor: '#0b0d13',
  accentColor: '#c9a24a',
  productBlurb: 'your Collector Network account',
  productVerb: 'track',
  gameLabel: 'TCG',
  officialGameUrl: null,
};

export const BRANDS: Record<Exclude<BrandSiteCode, 'network'>, Brand> = {
  pokemon: {
    siteCode: 'pokemon',
    brandName: 'PokePrices',
    senderName: 'PokePrices',
    fromAddress: 'PokePrices <hello@pokeprices.io>',
    replyToAddress: 'hello@pokeprices.io',
    hostnames: ['pokeprices.io', 'www.pokeprices.io'],
    productUrl: 'https://www.pokeprices.io',
    logoUrl: 'https://www.pokeprices.io/pokeprices-logo.png',
    primaryColor: '#1f3a8a',
    accentColor: '#f4b942',
    productBlurb: 'your Pokémon portfolio',
    productVerb: 'track',
    gameLabel: 'Pokémon TCG',
    officialGameUrl: 'https://www.pokemon.com/uk/pokemon-tcg/',
  },
  mtg: {
    siteCode: 'mtg',
    brandName: 'MTGPrices',
    senderName: 'MTGPrices',
    fromAddress: `MTGPrices <mtgprices@${SHARED_DOMAIN}>`,
    replyToAddress: NETWORK_REPLY_TO,
    hostnames: ['mtgprices.io', 'www.mtgprices.io'],
    productUrl: 'https://mtgprices.io',
    logoUrl: null,
    primaryColor: '#1b1f24',
    accentColor: '#c0392b',
    productBlurb: 'your MTG collection',
    productVerb: 'brew',
    gameLabel: 'Magic: The Gathering',
    officialGameUrl: 'https://magic.wizards.com/',
  },
  ygo: {
    siteCode: 'ygo',
    brandName: 'YGOPrices',
    senderName: 'YGOPrices',
    fromAddress: `YGOPrices <ygoprices@${SHARED_DOMAIN}>`,
    replyToAddress: NETWORK_REPLY_TO,
    hostnames: ['ygoprices.io', 'www.ygoprices.io'],
    productUrl: 'https://ygoprices.io',
    logoUrl: 'https://ygoprices.io/ygoprices-logo.png',
    primaryColor: '#0b0d13',
    accentColor: '#c9a24a',
    productBlurb: 'your Yu-Gi-Oh! collection, watchlist and decks',
    productVerb: 'duel',
    gameLabel: 'Yu-Gi-Oh!',
    officialGameUrl: 'https://www.yugioh-card.com/',
  },
  onepiece: {
    siteCode: 'onepiece',
    brandName: 'OnePiecePrices',
    senderName: 'OnePiecePrices',
    fromAddress: `OnePiecePrices <onepieceprices@${SHARED_DOMAIN}>`,
    replyToAddress: NETWORK_REPLY_TO,
    hostnames: ['onepieceprices.io', 'www.onepieceprices.io'],
    productUrl: 'https://onepieceprices.io',
    logoUrl: null,
    primaryColor: '#163969',
    accentColor: '#e63946',
    productBlurb: 'your One Piece Card Game collection',
    productVerb: 'sail',
    gameLabel: 'One Piece Card Game',
    officialGameUrl: 'https://en.onepiece-cardgame.com/',
  },
  lorcana: {
    siteCode: 'lorcana',
    brandName: 'LorcanaPrices',
    senderName: 'LorcanaPrices',
    fromAddress: `LorcanaPrices <lorcanaprices@${SHARED_DOMAIN}>`,
    replyToAddress: NETWORK_REPLY_TO,
    hostnames: ['lorcanaprices.io', 'www.lorcanaprices.io'],
    productUrl: 'https://lorcanaprices.io',
    logoUrl: null,
    primaryColor: '#4b2e83',
    accentColor: '#f4b942',
    productBlurb: 'your Disney Lorcana collection',
    productVerb: 'dream',
    gameLabel: 'Disney Lorcana',
    officialGameUrl: 'https://www.disneylorcana.com/',
  },
};

export function brandForSiteCode(code: BrandSiteCode | string): Brand {
  if (code === 'network') return NEUTRAL_BRAND;
  const b = (BRANDS as Record<string, Brand | undefined>)[code];
  return b ?? NEUTRAL_BRAND;
}

export function isSupportedSiteCode(code: string): code is Exclude<BrandSiteCode, 'network'> {
  return code in BRANDS;
}

// Sites that participate in the CN hub cron-driven email flow.
// PokePrices is excluded because it runs its own welcome/onboarding/
// weekly stack on its own domain (we must not duplicate those sends).
export const HUB_MANAGED_SITES: readonly Exclude<BrandSiteCode, 'network' | 'pokemon'>[] = [
  'mtg',
  'ygo',
  'onepiece',
  'lorcana',
] as const;

export function isHubManagedSite(code: string): code is typeof HUB_MANAGED_SITES[number] {
  return (HUB_MANAGED_SITES as readonly string[]).includes(code);
}
