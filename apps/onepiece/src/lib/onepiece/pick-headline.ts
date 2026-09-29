// Choose the headline market signal for a printing.
//
// Ordering: prefer 30-day average, then marketplace low, then top
// listing/trend. The label carries into the UI so users understand
// what number they are seeing. Extreme upstream listings (e.g. the
// €589,600 Zoro trend) still show — never hidden, never capped —
// but they are only surfaced when there is no more collector-honest
// signal available for that printing.

import type { RetailQuote } from '@collector-network/market-data';
import type { OpCurrency } from './currency';

export type HeadlineSignal = 'avg30d' | 'priceLow' | 'trend';

export const HEADLINE_SIGNAL_LABEL: Record<HeadlineSignal, string> = {
  avg30d: '30-day average',
  priceLow: 'Marketplace low',
  trend: 'Listing trend',
};

export interface HeadlinePrice {
  price: number;
  currency: OpCurrency;
  signal: HeadlineSignal;
  label: string;
  source: string;
  finish: string | null;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Pick the best headline price from a bag of retail quotes,
 *  restricted to the requested currency. Returns null if no quotes
 *  match the currency (caller shows an honest "unavailable" state). */
export function pickHeadlinePrice(
  quotes: readonly RetailQuote[] | undefined,
  currency: OpCurrency,
): HeadlinePrice | null {
  if (!quotes || quotes.length === 0) return null;
  const scoped = quotes.filter((q) => q.currency === currency);
  if (scoped.length === 0) return null;

  // Prefer, per quote, the strongest signal it carries. Then, across
  // quotes, prefer the median-like signal (avg30d) over price_low
  // over top listing. Two quotes for the same finish are rare; when
  // they occur pick the lowest headline so we never inflate.
  let best: HeadlinePrice | null = null;
  for (const q of scoped) {
    const candidates: Array<{ signal: HeadlineSignal; value: number | null }> = [
      { signal: 'avg30d', value: toNumber(q.avg30d) },
      { signal: 'priceLow', value: toNumber(q.priceLow) },
      { signal: 'trend', value: toNumber(q.price) },
    ];
    for (const c of candidates) {
      if (c.value == null) continue;
      const candidate: HeadlinePrice = {
        price: c.value,
        currency,
        signal: c.signal,
        label: HEADLINE_SIGNAL_LABEL[c.signal],
        source: q.source ?? '',
        finish: q.finish ?? null,
      };
      if (!best) { best = candidate; break; }
      // Prefer a better signal; if tied signal, prefer lower price
      // (more honest headline).
      const rank: Record<HeadlineSignal, number> = { avg30d: 0, priceLow: 1, trend: 2 };
      if (rank[candidate.signal] < rank[best.signal]) { best = candidate; break; }
      if (rank[candidate.signal] === rank[best.signal] && candidate.price < best.price) {
        best = candidate;
      }
      break;
    }
  }
  return best;
}

/** Reduce a family's per-printing quotes to a single headline for the
 *  family. Picks the highest headline across printings so the tile
 *  still reflects the chase / most-expensive treatment, but the value
 *  itself is a collector-honest signal chosen by pickHeadlinePrice. */
export function pickFamilyHeadline(
  quotesByPrinting: Map<string, readonly RetailQuote[]>,
  currency: OpCurrency,
): HeadlinePrice | null {
  let top: HeadlinePrice | null = null;
  for (const quotes of quotesByPrinting.values()) {
    const h = pickHeadlinePrice(quotes, currency);
    if (!h) continue;
    if (!top || h.price > top.price) top = h;
  }
  return top;
}
