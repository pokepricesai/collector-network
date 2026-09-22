import type { RetailQuote } from './types';

// Selection helpers layered on top of raw quote arrays. Never converts
// currencies. Callers must decide which currency they want to prefer.

export type CurrencyPreference = 'USD' | 'EUR' | 'GBP' | (string & {});

// Returns the "best" retail quote for a printing given a currency
// preference. "Best" = (1) currency match, (2) most recently updated,
// (3) has a non-null price. Returns null if no candidate qualifies.
export function selectPreferredRetailQuote(
  quotes: readonly RetailQuote[],
  preferCurrency: CurrencyPreference = 'USD',
): RetailQuote | null {
  if (quotes.length === 0) return null;
  const withPrice = quotes.filter((q) => q.price != null);
  if (withPrice.length === 0) return null;
  const preferred = withPrice.filter(
    (q) => q.currency.toUpperCase() === preferCurrency.toUpperCase(),
  );
  const pool = preferred.length > 0 ? preferred : withPrice;
  return [...pool].sort(
    (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0] ?? null;
}

// Group quotes by currency without merging. Useful for "show both USD
// and EUR side by side" flows.
export function groupQuotesByCurrency(
  quotes: readonly RetailQuote[],
): Map<string, RetailQuote[]> {
  const out = new Map<string, RetailQuote[]>();
  for (const q of quotes) {
    const key = q.currency.toUpperCase();
    const bucket = out.get(key);
    if (bucket) bucket.push(q);
    else out.set(key, [q]);
  }
  return out;
}
