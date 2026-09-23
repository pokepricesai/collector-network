// Public shapes exported by @collector-network/market-data. Deliberately
// separates raw retail listings, raw grader observations, and slabbed
// graded prices so callers cannot accidentally mix them.

export interface RetailQuote {
  printingId: string;
  source: string;
  listType: string | null;
  region: string | null;
  currency: string;
  finish: string | null;
  price: number | null;
  priceLow: number | null;
  priceTrend: number | null;
  avg1d: number | null;
  avg7d: number | null;
  avg30d: number | null;
  updatedAt: string;
}

import type { GradedAttribution } from '@collector-network/database';

export interface GradedQuote {
  // Exactly one of printingId or cardId is populated, matching the
  // attribution class. Callers must never treat these as
  // interchangeable — see the header comment on GradedAttribution.
  printingId: string | null;
  cardId: string | null;
  attribution: GradedAttribution;
  grader: string;
  grade: string;
  currency: string;
  price: number | null;
  cardSalesVolume: number | null;
  updatedAt: string;
}

// Grader value used in the shared graded table to denote raw-market
// observations rather than slabbed cards. Must never appear inside a
// GradedQuote returned as "graded".
export const RAW_GRADER = 'raw' as const;

// Card-scoped pricing bucket: quotes that describe the card family as a
// whole (attribution='card'). These CANNOT be attributed to a specific
// physical printing and must render in a clearly separate panel.
export interface CardScopedPricing {
  cardId: string;
  raw: GradedQuote[];    // attribution='card', grader='raw'
  graded: GradedQuote[]; // attribution='card', grader != 'raw'
}

export interface PrintingPricing {
  printingId: string;
  // Retail marketplace listings — TCGplayer, Cardmarket, etc.
  market: RetailQuote[];
  // Everything below is strictly attribution='printing' — safe to
  // render underneath the exact printing / edition / finish / language.
  raw: GradedQuote[];    // grader='raw', attribution='printing'
  graded: GradedQuote[]; // grader != 'raw', attribution='printing'
}
