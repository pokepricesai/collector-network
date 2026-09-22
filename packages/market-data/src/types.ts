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

export interface GradedQuote {
  printingId: string;
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

export interface PrintingPricing {
  printingId: string;
  // Retail marketplace listings — TCGplayer, Cardmarket, etc.
  market: RetailQuote[];
  // grader='raw' observations from tcg_graded_prices_current. These are raw
  // sales observations from grading aggregators, not marketplace listings.
  raw: GradedQuote[];
  // grader != 'raw' — actual slabbed cards (PSA/BGS/CGC/SGC/any).
  graded: GradedQuote[];
}
