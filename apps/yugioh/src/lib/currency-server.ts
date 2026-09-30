// Server-only currency-preference reader. Split from currency.ts so
// the client bundle doesn't need next/headers. Reads the first-party
// cookie set by /api/currency; defaults to USD.

import 'server-only';
import { cookies } from 'next/headers';
import { CURRENCY_COOKIE, DEFAULT_CURRENCY, isYgoCurrency, type YgoCurrency } from './currency';

export async function getYgoCurrency(): Promise<YgoCurrency> {
  const c = await cookies();
  const raw = c.get(CURRENCY_COOKIE)?.value ?? null;
  return isYgoCurrency(raw) ? raw : DEFAULT_CURRENCY;
}
