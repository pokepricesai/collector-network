// Currency preference for OnePiecePrices. Client-safe exports only.
// Server helpers (getCurrencyPreference) live in currency-server.ts
// so the client bundle never imports next/headers.

export const OP_CURRENCIES = ['EUR', 'USD'] as const;
export type OpCurrency = (typeof OP_CURRENCIES)[number];

export const CURRENCY_COOKIE = 'op_currency';
export const DEFAULT_CURRENCY: OpCurrency = 'EUR';

export function isOpCurrency(v: string | null | undefined): v is OpCurrency {
  return v === 'EUR' || v === 'USD';
}

export const CURRENCY_SYMBOL: Record<OpCurrency, string> = {
  EUR: '€',
  USD: '$',
};

export const CURRENCY_LABEL: Record<OpCurrency, string> = {
  EUR: 'EUR',
  USD: 'USD',
};

/** Native source for each currency. UI copy should name the source so
 *  users understand what feed backs the displayed number. */
export const CURRENCY_SOURCE_NAME: Record<OpCurrency, string> = {
  EUR: 'Cardmarket',
  USD: 'TCGPlayer',
};

/** Format a numeric price using the correct symbol for the currency.
 *  Returns 'Unpriced' when price is null. */
export function formatPrice(price: number | null | undefined, currency: OpCurrency, opts: { digits?: number } = {}): string {
  if (price == null || !Number.isFinite(price)) return 'Unpriced';
  const digits = opts.digits ?? 2;
  return `${CURRENCY_SYMBOL[currency]}${price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
