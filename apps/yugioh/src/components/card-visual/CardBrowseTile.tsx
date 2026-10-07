'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CardImageFrame } from '../CardImageFrame';
import { RarityBadge } from '../RarityBadge';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  isYgoCurrency,
  type YgoCurrency,
} from '../../lib/currency';
import styles from '../browse/Browse.module.css';

export interface CardBrowseTileProps {
  href: string;
  name: string;
  rarity: string | null | undefined;
  image: string | null | undefined;
  collectorNumber?: string | null;
  // Optional set line for pages where the tile is not already scoped
  // to a single set (rarity/archetype grids). Kept as a plain string
  // so callers can pass e.g. "LOB · 2002".
  setLine?: string | null;
  bestUsdRetail?: number | null;
  bestEurRetail?: number | null;
  /** Optional explicit currency hint. When omitted (recommended for
   *  ISR callers like /set, /rarity, /archetype) the tile starts
   *  from DEFAULT_CURRENCY on first render — matching the server
   *  HTML — and reads ygo_currency after mount. Dynamic callers that
   *  already know the server-side cookie can pass this to avoid the
   *  one-frame swap. */
  preferredCurrency?: YgoCurrency;
}

function readCurrencyCookie(): YgoCurrency {
  if (typeof document === 'undefined') return DEFAULT_CURRENCY;
  const prefix = `${CURRENCY_COOKIE}=`;
  const parts = document.cookie ? document.cookie.split(';') : [];
  for (const raw of parts) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(prefix)) {
      const value = decodeURIComponent(trimmed.slice(prefix.length));
      if (isYgoCurrency(value)) return value;
      return DEFAULT_CURRENCY;
    }
  }
  return DEFAULT_CURRENCY;
}

function formatPrice(value: number, currency: YgoCurrency): string {
  const sym = currency === 'EUR' ? '€' : '$';
  return `${sym}${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

// Shared tile for image-led card grids (set / rarity / archetype
// browse pages). Uses the .setCard* class family in Browse.module.css
// so all three surfaces render an identical visual language.
//
// Cookie-aware client component so callers (/set, /rarity,
// /archetype) can render without a server cookie() read. Hydration
// is safe because the first render always uses the explicit prop
// value or DEFAULT_CURRENCY; the real cookie value is applied in
// useEffect, matching the Lorcana P1a pattern.
export function CardBrowseTile(props: CardBrowseTileProps) {
  const {
    href,
    name,
    rarity,
    image,
    collectorNumber,
    setLine,
    bestUsdRetail,
    bestEurRetail,
    preferredCurrency: initialCurrency,
  } = props;

  const serverCurrency: YgoCurrency = initialCurrency ?? DEFAULT_CURRENCY;
  const [preferredCurrency, setPreferredCurrency] = useState<YgoCurrency>(serverCurrency);

  useEffect(() => {
    // Only consult the cookie when the caller did NOT pass an
    // explicit value. Dynamic routes that already read the cookie
    // server-side pass it in and own the authoritative choice.
    if (initialCurrency !== undefined) return;
    setPreferredCurrency(readCurrencyCookie());
    const onChange = () => setPreferredCurrency(readCurrencyCookie());
    window.addEventListener('ygo:currency-changed', onChange);
    return () => window.removeEventListener('ygo:currency-changed', onChange);
  }, [initialCurrency]);

  // Pick a primary + secondary based on the reader's currency pref.
  // If the preferred currency has no data we fall back to the other —
  // we never silently hide a price just because it's not in the
  // preferred currency. Only when BOTH are null do we show the
  // "no price data" state.
  const preferredValue = preferredCurrency === 'EUR' ? bestEurRetail : bestUsdRetail;
  const otherCurrency: YgoCurrency = preferredCurrency === 'EUR' ? 'USD' : 'EUR';
  const otherValue = otherCurrency === 'EUR' ? bestEurRetail : bestUsdRetail;

  const primary = preferredValue != null
    ? { currency: preferredCurrency, value: preferredValue }
    : otherValue != null
      ? { currency: otherCurrency, value: otherValue }
      : null;

  // Only show a secondary when primary used preferred (so we don't
  // repeat ourselves after falling back).
  const secondary =
    primary && primary.currency === preferredCurrency && otherValue != null
      ? { currency: otherCurrency, value: otherValue }
      : null;

  return (
    <Link
      href={href}
      className={styles.setCardTile}
      aria-label={`${name} - ${rarity ?? 'card'}${
        collectorNumber ? ` · ${collectorNumber}` : ''
      }`}
    >
      <div className={styles.setCardImageWrap}>
        <CardImageFrame src={image} alt={name} rarity={rarity} gloss={false} />
        {collectorNumber && (
          <span className={styles.setCardNumber}>{collectorNumber}</span>
        )}
      </div>
      <div className={styles.setCardBody}>
        <p className={styles.setCardName} title={name}>
          {name}
        </p>
        <div className={styles.setCardMetaRow}>
          <RarityBadge rarity={rarity} />
          {setLine && <span className={styles.setCardSetLine}>{setLine}</span>}
        </div>
        <div className={styles.setCardPriceRow}>
          {primary ? (
            <span className={styles.setCardPrice}>
              {formatPrice(primary.value, primary.currency)}
            </span>
          ) : (
            <span className={styles.setCardPriceDim} title="No market price data on file for this printing yet">
              No price data
            </span>
          )}
          {secondary && (
            <span className={styles.setCardPriceAlt}>
              {formatPrice(secondary.value, secondary.currency)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
