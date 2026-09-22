// Narrow domain types matching the audited production shape of the shared
// `tcg_*` tables. See docs/yugioh/data-audit.md for how each field was
// derived. These are hand-written rather than generated because generation
// requires DB admin access we do not have from this repo.
//
// Semantics live in per-app read layers, not here.

export interface TcgGame {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface TcgSet {
  id: string;
  game_id: string;
  code: string;
  name: string;
  released_at: string | null;
  tcggraph_meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
}

export interface TcgCardImages {
  large?: string;
  normal?: string;
  small?: string;
}

export interface TcgCard {
  id: string;
  game_id: string;
  tcggraph_card_id: string | null;
  name: string;
  english_id: string | null;
  language: string;
  rarity: string | null;
  artist: string | null;
  rules_text: string | null;
  images: TcgCardImages | null;
  gamedata: Record<string, unknown> | null;
  set_id: string;
  collector_number: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TcgPrinting {
  id: string;
  game_id: string;
  tcg_card_id: string;
  set_id: string;
  tcggraph_card_id: string | null;
  tcggraph_printing_key: string | null;
  finish: string | null;
  edition: string | null;
  language: string;
  collector_number: string | null;
  mtg_printings_id: string | null;
  cardmarket_id: number | null;
  tcgplayer_id: number | null;
  mapping_confidence: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TcgMarketPriceCurrent {
  tcg_printing_id: string;
  game_id: string;
  source: string;
  list_type: string | null;
  region: string | null;
  currency: string;
  finish: string | null;
  price: number | null;
  price_low: number | null;
  price_trend: number | null;
  avg_1d: number | null;
  avg_7d: number | null;
  avg_30d: number | null;
  updated_at: string;
  ingested_at: string;
  source_run_id: string | null;
}

export interface TcgGradedPriceCurrent {
  tcg_printing_id: string;
  game_id: string;
  grader: string;
  grade: string;
  currency: string;
  price: number | null;
  card_sales_volume: number | null;
  updated_at: string;
  ingested_at: string;
  source_run_id: string | null;
}

export interface TcgMarketPriceDaily
  extends Omit<TcgMarketPriceCurrent, 'ingested_at' | 'updated_at'> {
  observed_on: string;
}

export interface TcgGradedPriceDaily
  extends Omit<TcgGradedPriceCurrent, 'ingested_at' | 'updated_at'> {
  observed_on: string;
}

// Join model — a TcgCard together with its containing TcgSet.
export interface TcgCardWithSet extends TcgCard {
  set: TcgSet;
}
