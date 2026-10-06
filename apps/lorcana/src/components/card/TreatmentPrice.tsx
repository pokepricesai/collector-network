'use client';

import { useEffect, useState } from 'react';
import type { PrintingPricing } from '@collector-network/market-data';
import { formatPrice } from '@/lib/lorcana/format-price';
import { formatPrice as formatSelected } from '@/lib/currency';
import { selectPreferredRetailQuote } from '@collector-network/market-data';
import {
  CURRENCY_COOKIE,
  CURRENCY_SOURCE_KEY,
  DEFAULT_CURRENCY,
  isLorcanaCurrency,
  type LorcanaCurrency,
} from '@/lib/currency';

// Price summary for a single priced printing. Reads the caller's
// PrintingPricing (retail + attribution='printing' graded) and renders
// only the buckets that have data. Never mixes currencies.
//
// Client component so pages served from the ISR edge cache can swap
// the display currency without baking it into the HTML. First render
// matches the server HTML (DEFAULT_CURRENCY — no document.cookie
// access on the server). Subsequent render reflects the real
// lorcana_currency cookie read on mount.
//
// When `currency` is supplied we ONLY consider retail rows in that
// currency's native source (USD → TCGplayer, EUR → Cardmarket) —
// missing = show "No current price", never silently fall back to
// the other market.

function readCurrencyCookie(): LorcanaCurrency {
  if (typeof document === 'undefined') return DEFAULT_CURRENCY;
  const prefix = `${CURRENCY_COOKIE}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      const value = decodeURIComponent(trimmed.slice(prefix.length));
      if (isLorcanaCurrency(value)) return value;
      return DEFAULT_CURRENCY;
    }
  }
  return DEFAULT_CURRENCY;
}

export default function TreatmentPrice({
  pricing,
  currency,
}: {
  pricing: PrintingPricing;
  /** Starting currency. Omit (or pass undefined) on ISR'd pages so
   *  the component falls back to DEFAULT_CURRENCY on first render
   *  and reads the cookie after mount. Pass a value on Dynamic
   *  routes where the server already read the cookie. */
  currency?: LorcanaCurrency;
}) {
  const serverCurrency = currency ?? DEFAULT_CURRENCY;
  const [resolved, setResolved] = useState<LorcanaCurrency>(serverCurrency);

  useEffect(() => {
    // Only override from the cookie when the caller did NOT already
    // pass a currency (ISR mode). On Dynamic routes the server read
    // the cookie itself and knows better than we do here.
    if (currency !== undefined) return;
    setResolved(readCurrencyCookie());
    const onChange = () => setResolved(readCurrencyCookie());
    window.addEventListener('lorcana:currency-changed', onChange);
    return () => window.removeEventListener('lorcana:currency-changed', onChange);
  }, [currency]);

  const nativeSource = CURRENCY_SOURCE_KEY[resolved];
  const currencyScopedRetail = pricing.market.filter(
    (q) => q.currency === resolved && q.source === nativeSource,
  );
  const preferred = selectPreferredRetailQuote(currencyScopedRetail, resolved);

  const rawFloor = pickLowestNonNull(
    pricing.raw.map((r) => ({ price: r.price, currency: r.currency })),
  );
  const gradedTop = pickHighestNonNull(
    pricing.graded.map((g) => ({
      price: g.price,
      currency: g.currency,
      grader: g.grader,
      grade: g.grade,
    })),
  );

  if (!preferred && !rawFloor && !gradedTop) {
    return (
      <div
        className="label-mono"
        style={{
          color: 'var(--text-muted)',
          padding: '8px 0',
        }}
      >
        No priced observations yet
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
      }}
    >
      {preferred ? (
        <PriceRow
          label="Retail"
          headline={formatPrice(preferred.price, preferred.currency)}
          detail={`${preferred.source}${preferred.finish ? ' · ' + preferred.finish : ''}`}
        />
      ) : (
        <PriceRow
          label="Retail"
          headline={formatSelected(null, resolved)}
          detail={`Native ${resolved} feed`}
          muted
        />
      )}
      {rawFloor && (
        <PriceRow
          label="Raw"
          headline={formatPrice(rawFloor.price, rawFloor.currency)}
          detail="Ungraded floor"
          muted
        />
      )}
      {gradedTop && (
        <PriceRow
          label={`${gradedTop.grader.toUpperCase()} ${gradedTop.grade}`}
          headline={formatPrice(gradedTop.price, gradedTop.currency)}
          detail="Top graded quote"
          accent="gold"
        />
      )}
    </div>
  );
}

function PriceRow({
  label,
  headline,
  detail,
  muted,
  accent,
}: {
  label: string;
  headline: string;
  detail: string;
  muted?: boolean;
  accent?: 'gold';
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        padding: '4px 0',
      }}
    >
      <span
        className="label-mono"
        style={{
          color: accent === 'gold' ? 'var(--accent-2)' : 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ textAlign: 'right' }}>
        <span
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 700,
            fontSize: muted ? 15 : 17,
            color: 'var(--text-strong)',
          }}
        >
          {headline}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          {detail}
        </span>
      </span>
    </div>
  );
}

function pickLowestNonNull<T extends { price: number | null }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.price == null) continue;
    if (best == null || r.price < (best.price ?? Infinity)) best = r;
  }
  return best;
}

function pickHighestNonNull<T extends { price: number | null }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.price == null) continue;
    if (best == null || r.price > (best.price ?? -Infinity)) best = r;
  }
  return best;
}
