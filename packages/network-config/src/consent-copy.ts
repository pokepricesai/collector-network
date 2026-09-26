// Shared consent copy registry for the Collector Network.
//
// One source of truth for the labels, descriptions and shared
// account explanation shown in signup forms, /settings and
// /email-preferences across every site. Sites read this
// registry; they do not invent their own strings.
//
// The consent TEXT VERSION lives in the database
// (collector_consent_versions), not here. This module holds only
// display copy. If wording changes materially, bump the version
// via an explicit DB migration AND update the copy below in the
// same commit.

import type { NetworkGameId } from './index';

// Sites addressable by the visible consent UI. These are the
// site codes used in the DB (collector_sites.code), which differ
// from NetworkGameId in two places: 'magic' → 'mtg', 'yugioh' →
// 'ygo'. The mapping is centralised here.
export type SiteConsentCode = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana';

export const NETWORK_GAME_TO_SITE_CODE: Record<NetworkGameId, SiteConsentCode> = {
  pokemon: 'pokemon',
  magic: 'mtg',
  yugioh: 'ygo',
  onepiece: 'onepiece',
  lorcana: 'lorcana',
};

// Copy shown on the "opt in to this site's newsletter" checkbox
// on that site's signup form and its Settings row.
export interface SiteConsentCopy {
  siteCode: SiteConsentCode;
  brandName: string;
  label: string;
  description: string;
}

// Copy shown on the "opt in to Collector Network updates"
// checkbox everywhere.
export interface NetworkConsentCopy {
  label: string;
  description: string;
}

// Per-site consent copy. Kept plain: no em dashes, one short
// sentence for the description.
export const SITE_CONSENT_COPY: Record<SiteConsentCode, SiteConsentCopy> = {
  pokemon: {
    siteCode: 'pokemon',
    brandName: 'PokePrices',
    label: 'Send me PokePrices emails',
    description:
      'Card prices, market updates, new sets and PokePrices features.',
  },
  mtg: {
    siteCode: 'mtg',
    brandName: 'MTGPrices',
    label: 'Send me MTGPrices emails',
    description:
      'Card prices, market updates, new sets and MTGPrices features.',
  },
  ygo: {
    siteCode: 'ygo',
    brandName: 'YGOPrices',
    label: 'Send me YGOPrices emails',
    description:
      'Card prices, market updates, new sets and YGOPrices features.',
  },
  onepiece: {
    siteCode: 'onepiece',
    brandName: 'One Piece Card Game',
    label: 'Send me One Piece Card Game emails',
    description:
      'Card prices, market updates, new sets and One Piece features.',
  },
  lorcana: {
    siteCode: 'lorcana',
    brandName: 'Disney Lorcana',
    label: 'Send me Disney Lorcana emails',
    description:
      'Card prices, market updates, new sets and Lorcana features.',
  },
};

export const NETWORK_CONSENT_COPY: NetworkConsentCopy = {
  label: 'Send me occasional Collector Network updates',
  description:
    'New card game sites, major features and selected updates from across the network.',
};

// Small piece of explanatory copy standardised across every
// signup form so users understand the shared account model
// without implying automatic membership or automatic newsletter
// signup.
export const SHARED_ACCOUNT_EXPLANATION =
  'Your account also works across our other Collector Network card sites. Each site keeps its own data and its own email preferences.';

// Convenience: get copy for a site by DB code.
export function copyForSite(siteCode: SiteConsentCode): SiteConsentCopy {
  return SITE_CONSENT_COPY[siteCode];
}
