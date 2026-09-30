// Currency preference for LorcanaPrices. Client-safe exports only.
// Server helpers (getLorcanaCurrency) live in currency-server.ts so
// the client bundle never imports next/headers.
//
// Default is USD because TCGPlayer is the primary retail feed for
// Lorcana in the North-American market. EUR selects the Cardmarket
// native feed — never FX-converted from USD.

export const LORCANA_CURRENCIES = ['USD', 'EUR'] as const;
export type LorcanaCurrency = (typeof LORCANA_CURRENCIES)[number];

export const CURRENCY_COOKIE = 'lorcana_currency';
export const DEFAULT_CURRENCY: LorcanaCurrency = 'USD';

export function isLorcanaCurrency(v: string | null | undefined): v is LorcanaCurrency {
  return v === 'USD' || v === 'EUR';
}

export const CURRENCY_SYMBOL: Record<LorcanaCurrency, string> = {
  USD: '$',
  EUR: '€',
};

/** Native marketplace source for each currency. Never converted. */
export const CURRENCY_SOURCE_NAME: Record<LorcanaCurrency, string> = {
  USD: 'TCGPlayer',
  EUR: 'Cardmarket',
};

/** Which tcg_market_prices_current.source label to read for a currency. */
export const CURRENCY_SOURCE_KEY: Record<LorcanaCurrency, string> = {
  USD: 'tcggraph.tcgplayer',
  EUR: 'tcggraph.cardmarket',
};

/** Format a numeric price using the correct symbol. `null` returns
 *  "No current price" — never silently substitutes the other market. */
export function formatPrice(
  price: number | null | undefined,
  currency: LorcanaCurrency,
  opts: { digits?: number; emptyLabel?: string } = {},
): string {
  if (price == null || !Number.isFinite(price)) return opts.emptyLabel ?? 'No current price';
  const digits = opts.digits ?? 2;
  return `${CURRENCY_SYMBOL[currency]}${price.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
