// Server-only currency-preference reader. Reads the first-party
// cookie set by /api/currency; defaults to USD.

import 'server-only';
import { cookies } from 'next/headers';
import { CURRENCY_COOKIE, DEFAULT_CURRENCY, isLorcanaCurrency, type LorcanaCurrency } from './currency';

export async function getLorcanaCurrency(): Promise<LorcanaCurrency> {
  const c = await cookies();
  const raw = c.get(CURRENCY_COOKIE)?.value ?? null;
  return isLorcanaCurrency(raw) ? raw : DEFAULT_CURRENCY;
}
