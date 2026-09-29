// Server-only currency-preference reader. Split from currency.ts so
// the client bundle doesn't need next/headers.

import 'server-only';
import { cookies } from 'next/headers';
import { CURRENCY_COOKIE, DEFAULT_CURRENCY, isOpCurrency, type OpCurrency } from './currency';

export async function getCurrencyPreference(): Promise<OpCurrency> {
  const c = await cookies();
  const raw = c.get(CURRENCY_COOKIE)?.value ?? null;
  return isOpCurrency(raw) ? raw : DEFAULT_CURRENCY;
}
