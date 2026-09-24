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

// ── Historical (daily) shapes ────────────────────────────────────
// Point in a forward-accumulating daily price series. Currency and
// source are always preserved so callers can never accidentally mix
// currencies into one line. `observedOn` is a date-only string
// (YYYY-MM-DD) — the daily tables snapshot once per calendar day.

export interface DailyRetailPoint {
  printingId: string;
  observedOn: string;   // YYYY-MM-DD
  source: string;
  listType: string | null;
  currency: string;
  finish: string | null;
  price: number | null;
  priceLow: number | null;
  priceTrend: number | null;
  avg1d: number | null;
  avg7d: number | null;
  avg30d: number | null;
}

export interface DailyGradedPoint {
  // Exactly one is populated, matching attribution — same rule as
  // GradedQuote. Charts must never render a card-scoped series under
  // a specific-printing label.
  printingId: string | null;
  cardId: string | null;
  attribution: GradedAttribution;
  observedOn: string;
  grader: string;
  grade: string;
  currency: string;
  price: number | null;
  cardSalesVolume: number | null;
}
