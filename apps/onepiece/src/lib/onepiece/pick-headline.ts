// Choose the headline market signal for a printing.
//
// Ordering: prefer 30-day average, then marketplace low, then top
// listing/trend. The label carries into the UI so users understand
// what number they are seeing.
//
// Outlier guard (OP-TRUST-01, 2026-10-30): a priceLow or price value
// qualifies as a headline only when it survives a per-quote outlier
// check. Three audited failure modes drove the design:
//
//   (a) Zoro OP12-020_p2: price=€589,600, priceLow=€39,999, all
//       averaging columns null → listing/low 14.7x apart, obvious
//       manipulation.
//   (b) ST21-015_p2 "Marshall D. Teach": priceLow=€175,000 with
//       price=€59.99 and avg_30d=€59.99 — a single bogus listing
//       sits far above the smoothed signal.
//   (c) EB01-003_p4: priceLow=€1,000,000 with avg_30d=€775 — same
//       pattern, averaging present but the lone marketplace low is
//       absurd relative to it.
//
// Guard: per candidate (priceLow or price/trend), skip it when:
//   * averaging data exists AND value > OUTLIER_VS_AVG × average
//     (default 4×). This catches (b) and (c).
//   * averaging data is absent AND the opposing field (price for
//     priceLow, priceLow for price) is populated AND the two are
//     > OUTLIER_RATIO apart (default 5×). This catches (a).
//
// What the guard does NOT do:
//   * It does NOT cap prices. Genuinely high-value cards with
//     consistent averaging / listing data (chase cards at $5k with
//     avg_30d $4.8k) still surface normally.
//   * It does NOT require two sources. A single TCGplayer quote at
//     $90 with priceLow $75 and no averaging surfaces normally
//     (ratio 1.2× << 5×).
//   * It does NOT silently delete anything from tcg_market_prices_
//     current. The row is preserved for diagnostics; only the UI
//     headline suppresses it.

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

// Thresholds — chosen conservatively from the known-outlier set.
// Zoro case is 14.7×; the smallest legitimate TCGplayer foil
// price/low gap on real data is ~1.3×, so 5× is comfortable.
// For averaging-anchored checks, 4× covers the known cases
// (st21_015_p2 is 2917×, eb01_003_p4 is 1290×, st01_013_p2 is 97×)
// without catching a legitimate chase card temporarily spiking.
const OUTLIER_RATIO       = 5;
const OUTLIER_VS_AVG      = 4;
// Ratio noise dominates at tiny values — TCGplayer's priceLow
// sentinel is $0.01, so a common card with price $0.07 has
// ratio=7× for mechanical reasons, not outlier reasons. Ignore
// the ratio check when the smaller of the two compared values is
// below this floor. Catches the ~1,700 OP commons we would
// otherwise suppress by accident.
const RATIO_FLOOR         = 1;

function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** True if `value` looks like a quote-local outlier. Used only for
 *  the priceLow and trend candidates — avg30d itself is treated as
 *  the trustworthy smoothed signal and never gated. */
function isQuoteLocalOutlier(value: number, q: RetailQuote, otherField: 'price' | 'priceLow'): boolean {
  const avg = toNumber(q.avg30d) ?? toNumber(q.avg7d) ?? toNumber(q.avg1d);
  if (avg != null) {
    return value > OUTLIER_VS_AVG * avg;
  }
  // No averaging anchor. Fall back to intra-quote consistency.
  const other = toNumber(otherField === 'price' ? q.price : q.priceLow);
  if (other == null) return false;   // only one field — nothing to compare, trust the data
  const minV = Math.min(value, other);
  if (minV < RATIO_FLOOR) return false;   // bulk-card ratio noise; trust the data
  const ratio = Math.max(value, other) / minV;
  return ratio > OUTLIER_RATIO;
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
    const priceLowVal = toNumber(q.priceLow);
    const trendVal    = toNumber(q.price);
    const priceLowOk  = priceLowVal != null && !isQuoteLocalOutlier(priceLowVal, q, 'price');
    const trendOk     = trendVal    != null && !isQuoteLocalOutlier(trendVal,    q, 'priceLow');
    const candidates: Array<{ signal: HeadlineSignal; value: number | null }> = [
      { signal: 'avg30d',   value: toNumber(q.avg30d) },
      { signal: 'priceLow', value: priceLowOk ? priceLowVal : null },
      { signal: 'trend',    value: trendOk    ? trendVal    : null },
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
