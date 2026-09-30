// Currency preference for YGOPrices. Client-safe exports only.
// Server helpers (getYgoCurrency) live in currency-server.ts so the
// client bundle never imports next/headers.
//
// Default is USD because TCGPlayer is the primary Yu-Gi-Oh feed and
// most collectors identify USD prices with the game. EUR selects the
// Cardmarket feed — never FX-converted from USD.

export const YGO_CURRENCIES = ['USD', 'EUR'] as const;
export type YgoCurrency = (typeof YGO_CURRENCIES)[number];

export const CURRENCY_COOKIE = 'ygo_currency';
export const DEFAULT_CURRENCY: YgoCurrency = 'USD';

export function isYgoCurrency(v: string | null | undefined): v is YgoCurrency {
  return v === 'USD' || v === 'EUR';
}

export const CURRENCY_SYMBOL: Record<YgoCurrency, string> = {
  USD: '$',
  EUR: '€',
};

/** Native marketplace source for each currency. Never converted. */
export const CURRENCY_SOURCE_NAME: Record<YgoCurrency, string> = {
  USD: 'TCGPlayer',
  EUR: 'Cardmarket',
};

/** Format a numeric price using the correct symbol. `null` returns
 *  "No current price" (spec: never silently fall back to the other
 *  currency). */
export function formatPrice(
  price: number | null | undefined,
  currency: YgoCurrency,
  opts: { digits?: number; emptyLabel?: string } = {},
): string {
  if (price == null || !Number.isFinite(price)) return opts.emptyLabel ?? 'No current price';
  const digits = opts.digits ?? 2;
  return `${CURRENCY_SYMBOL[currency]}${price.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
