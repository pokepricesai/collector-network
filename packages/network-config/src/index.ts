// @collector-network/network-config — cross-site constants.
//
// Canonical identifiers for the games and sites in the Collector Network.
// This is the ONE place where the mapping "game <-> tcg_games row" lives, so
// every site (and every shared package) agrees on what "yugioh", "onepiece",
// "lorcana", "pokemon", "magic" resolve to.

export type NetworkGameId =
  | "pokemon"
  | "magic"
  | "yugioh"
  | "onepiece"
  | "lorcana";

export interface NetworkSite {
  readonly gameId: NetworkGameId;
  readonly displayName: string;
  /** True if the site lives in this monorepo. */
  readonly inMonorepo: boolean;
}

export const NETWORK_SITES: readonly NetworkSite[] = [
  { gameId: "pokemon", displayName: "Pokémon (PokePrices)", inMonorepo: false },
  { gameId: "magic", displayName: "Magic: The Gathering (MTGPrices)", inMonorepo: false },
  { gameId: "yugioh", displayName: "Yu-Gi-Oh", inMonorepo: true },
  { gameId: "onepiece", displayName: "One Piece Card Game", inMonorepo: true },
  { gameId: "lorcana", displayName: "Disney Lorcana", inMonorepo: true },
] as const;

// Slice CN-B: shared consent copy (labels, descriptions, shared
// account explanation). Version constant lives in the DB
// (collector_consent_versions). Sites import these strings so
// wording stays in one place.
export {
  copyForSite,
  NETWORK_CONSENT_COPY,
  NETWORK_GAME_TO_SITE_CODE,
  SHARED_ACCOUNT_EXPLANATION,
  SITE_CONSENT_COPY,
} from './consent-copy';
export type {
  NetworkConsentCopy,
  SiteConsentCode,
  SiteConsentCopy,
} from './consent-copy';
