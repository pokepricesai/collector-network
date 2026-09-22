import type {
  TcgGradedPriceCurrent,
  TcgMarketPriceCurrent,
} from '@collector-network/database';
import type { GradedQuote, RetailQuote } from './types.js';
import { RAW_GRADER } from './types.js';

// Row → domain-shape mappers. Pure. No IO. Deterministic.

export function toRetailQuote(row: TcgMarketPriceCurrent): RetailQuote {
  return {
    printingId: row.tcg_printing_id,
    source: row.source,
    listType: row.list_type,
    region: row.region,
    currency: row.currency,
    finish: row.finish,
    price: row.price,
    priceLow: row.price_low,
    priceTrend: row.price_trend,
    avg1d: row.avg_1d,
    avg7d: row.avg_7d,
    avg30d: row.avg_30d,
    updatedAt: row.updated_at,
  };
}

export function toGradedQuote(row: TcgGradedPriceCurrent): GradedQuote {
  return {
    printingId: row.tcg_printing_id,
    grader: row.grader,
    grade: row.grade,
    currency: row.currency,
    price: row.price,
    cardSalesVolume: row.card_sales_volume,
    updatedAt: row.updated_at,
  };
}

export function isRawObservation(row: TcgGradedPriceCurrent): boolean {
  return row.grader === RAW_GRADER;
}
