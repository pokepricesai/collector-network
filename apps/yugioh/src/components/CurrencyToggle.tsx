'use client';

// Site-wide currency toggle. Segmented USD | EUR. Sets a first-party
// cookie via /api/currency then refreshes the current route so every
// server component re-reads pricing in the selected currency. Default
// is USD for new visitors (see currency.ts).
//
// When `initial` is omitted the toggle starts from DEFAULT_CURRENCY
// and reads the ygo_currency cookie after mount. This lets a caller
// (notably the Header) render without server-side cookie access,
// which is what unlocks the Full Route Cache on public pages.
// Pattern mirrors Lorcana P1a TreatmentPrice.

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  YGO_CURRENCIES,
  isYgoCurrency,
  type YgoCurrency,
} from '@/lib/currency';
import styles from './CurrencyToggle.module.css';

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

export function CurrencyToggle({ initial }: { initial?: YgoCurrency }) {
  const router = useRouter();
  // Hydration-safe: match the server HTML on first render by using
  // DEFAULT_CURRENCY when the caller does not supply a resolved
  // value. Dynamic callers that already know the server-side cookie
  // can pass `initial` explicitly to avoid the one-frame swap.
  const serverCurrency: YgoCurrency = initial ?? DEFAULT_CURRENCY;
  const [current, setCurrent] = useState<YgoCurrency>(serverCurrency);
  const [pending, start] = useTransition();

  useEffect(() => {
    // Only read the cookie when the caller did NOT already pass a
    // resolved value. On Dynamic pages the server already knows,
    // and overwriting here would needlessly cause a rerender.
    if (initial !== undefined) return;
    setCurrent(readCurrencyCookie());
    const onChange = () => setCurrent(readCurrencyCookie());
    window.addEventListener('ygo:currency-changed', onChange);
    return () => window.removeEventListener('ygo:currency-changed', onChange);
  }, [initial]);

  function pick(c: YgoCurrency) {
    if (c === current) return;
    setCurrent(c);
    start(async () => {
      try {
        await fetch('/api/currency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currency: c }),
        });
      } catch {
        setCurrent(serverCurrency);
        return;
      }
      // Notify currency-aware client islands on ISR pages where
      // router.refresh() alone would hit the cached RSC payload and
      // not propagate the change. The event is additive — Dynamic
      // callers continue to pick up the new cookie via the refresh.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('ygo:currency-changed', { detail: { currency: c } }),
        );
      }
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="Currency"
      className={styles.root}
      data-pending={pending || undefined}
    >
      {YGO_CURRENCIES.map((c) => {
        const active = c === current;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => pick(c)}
            className={styles.btn}
            data-active={active || undefined}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
