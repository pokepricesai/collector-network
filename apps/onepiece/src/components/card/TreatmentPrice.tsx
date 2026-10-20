'use client';

// Price summary for a single priced printing. Reads the caller's
// PrintingPricing (retail + attribution='printing' graded) and renders
// only the buckets that have data. Never mixes currencies.
//
// CN-COST-03 C: converted to a client component mirroring the Lorcana
// P1a pattern so pages served from the ISR edge cache can swap the
// display currency without baking it into the HTML.
//
//   - First render matches the server HTML (DEFAULT_CURRENCY — no
//     document.cookie access on the server; OPP's default is EUR).
//   - On ISR routes the caller omits `currency`; the useEffect reads
//     the real `op_currency` cookie on mount and re-renders.
//   - On Dynamic routes the server already read the cookie via
//     getCurrencyPreference(); the caller passes `currency` explicitly
//     and the hook deliberately does NOT override it.
//
// Subscribes to `onepiece:currency-changed` (fired by CurrencyToggle)
// so a toggle flips the panel without a reload.

import { useEffect, useState } from 'react';
import type { PrintingPricing } from '@collector-network/market-data';
import { formatPrice } from '@/lib/onepiece/format-price';
import { pickHeadlinePrice, HEADLINE_SIGNAL_LABEL } from '@/lib/onepiece/pick-headline';
import {
  CURRENCY_COOKIE,
  CURRENCY_SOURCE_NAME,
  DEFAULT_CURRENCY,
  isOpCurrency,
  type OpCurrency,
} from '@/lib/onepiece/currency';

function readCurrencyCookie(): OpCurrency {
  if (typeof document === 'undefined') return DEFAULT_CURRENCY;
  const prefix = `${CURRENCY_COOKIE}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      const value = decodeURIComponent(trimmed.slice(prefix.length));
      if (isOpCurrency(value)) return value;
      return DEFAULT_CURRENCY;
    }
  }
  return DEFAULT_CURRENCY;
}

// Turn a `RetailQuote.source` string into the marketplace it belongs
// to. Sources look like `tcggraph.tcgplayer` or
// `tcggraph.cardmarket` — we only need the trailing token. Anything
// unrecognised falls back to the currency's native source name (EUR
// → Cardmarket, USD → TCGPlayer) so a mislabelled row still gets a
// truthful native label rather than "Retail".
function sourceLabel(source: string | null | undefined, currency: OpCurrency): string {
  const s = (source ?? '').toLowerCase();
  if (s.includes('tcgplayer')) return 'TCGPlayer';
  if (s.includes('cardmarket')) return 'Cardmarket';
  return CURRENCY_SOURCE_NAME[currency];
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
  currency?: OpCurrency;
}) {
  const serverCurrency = currency ?? DEFAULT_CURRENCY;
  const [resolved, setResolved] = useState<OpCurrency>(serverCurrency);

  useEffect(() => {
    // Only override from the cookie when the caller did NOT already
    // pass a currency (ISR mode). On Dynamic routes the server read
    // the cookie itself and knows better than we do here.
    if (currency !== undefined) return;
    setResolved(readCurrencyCookie());
    const onChange = () => setResolved(readCurrencyCookie());
    window.addEventListener('onepiece:currency-changed', onChange);
    return () => window.removeEventListener('onepiece:currency-changed', onChange);
  }, [currency]);

  const headline = pickHeadlinePrice(pricing.market, resolved);

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

  if (!headline && !rawFloor && !gradedTop) {
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

  // Source-native price label: "Cardmarket 30-day average",
  // "Cardmarket marketplace low", "TCGPlayer 30-day average",
  // "TCGPlayer listing trend". NEVER the generic word "Retail" —
  // the user is entitled to see WHICH marketplace the number came
  // from and WHICH signal it represents.
  const sourceName = headline ? sourceLabel(headline.source, headline.currency) : null;
  const priceLabel = headline
    ? `${sourceName} ${HEADLINE_SIGNAL_LABEL[headline.signal].toLowerCase()}`
    : '';
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
      }}
    >
      {headline && (
        <PriceRow
          label={priceLabel}
          headline={formatPrice(headline.price, headline.currency)}
          detail={headline.finish ? headline.finish : sourceName ?? ''}
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
          color: accent === 'gold' ? 'var(--gold-600)' : 'var(--text-muted)',
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
