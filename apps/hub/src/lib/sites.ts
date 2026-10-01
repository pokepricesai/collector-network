// Canonical configuration for the five specialist Collector Network
// platforms. Each production URL was verified live against the current
// Vercel project aliases on 2026-10-02.

export interface SiteCard {
  slug: 'pokeprices' | 'mtgprices' | 'ygoprices' | 'onepieceprices' | 'lorcanaprices';
  name: string;
  descriptor: string;
  href: string;
  logo: string;
  /** Pixel dimensions of the source logo file in /public/sites/. */
  width: number;
  height: number;
  /** Restrained brand-anchor colour used only for a very subtle hover
   *  glow on each platform card. Logos remain the dominant surface;
   *  the colour just hints that each tile belongs to a distinct
   *  brand. Values chosen conservatively from the public site
   *  identities, not reused for backgrounds or type. */
  accent: string;
}

export const SITES: readonly SiteCard[] = [
  {
    slug: 'pokeprices',
    name: 'PokePrices',
    descriptor: 'Pokémon card prices and market data',
    href: 'https://www.pokeprices.io',
    logo: '/sites/pokeprices.png',
    width: 1024,
    height: 1024,
    accent: '#CC0000',
  },
  {
    slug: 'mtgprices',
    name: 'MTGPrices',
    descriptor: 'Magic pricing, collecting and gameplay tools',
    href: 'https://mtgprices.io',
    logo: '/sites/mtgprices.png',
    width: 2048,
    height: 2048,
    accent: '#B38A2F',
  },
  {
    slug: 'ygoprices',
    name: 'YGOPrices',
    descriptor: 'Yu-Gi-Oh! card prices and market data',
    href: 'https://ygoprices.io',
    logo: '/sites/ygoprices.png',
    width: 1024,
    height: 1024,
    accent: '#8A4CC9',
  },
  {
    slug: 'onepieceprices',
    name: 'OnePiecePrices',
    descriptor: 'One Piece Card Game prices and collector tools',
    href: 'https://www.onepieceprices.io',
    logo: '/sites/onepieceprices.png',
    width: 1024,
    height: 1024,
    accent: '#C8102E',
  },
  {
    slug: 'lorcanaprices',
    name: 'LorcanaPrices',
    descriptor: 'Disney Lorcana prices and collector tools',
    href: 'https://www.lorcanaprices.io',
    logo: '/sites/lorcanaprices.png',
    width: 2172,
    height: 724,
    accent: '#6A43BE',
  },
];

export const SITE_URL = 'https://www.collector.network';
export const SITE_NAME = 'Collector Network';
