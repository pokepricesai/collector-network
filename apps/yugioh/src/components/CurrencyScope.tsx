'use client';

// Tiny client gate that renders children only when the viewer's
// current currency preference matches `currency`. Used to wrap
// StaleSourceNotice pairs on pages where the server-rendered HTML
// contains both USD and EUR variants and the client picks which to
// show.
//
// Hydration-safe: the first render always shows the content that
// matches DEFAULT_CURRENCY (USD). After mount the cookie is read
// and the mismatched block hides. EUR-cookie visitors see both
// notices for one frame and then the USD one disappears — same
// shape as Lorcana P1a TreatmentPrice.
//
// Subscribes to the `ygo:currency-changed` window event so a
// currency toggle flips visibility without a reload on ISR pages.

import { useEffect, useState, type ReactNode } from 'react';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  isYgoCurrency,
  type YgoCurrency,
} from '../lib/currency';

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

interface Props {
  currency: YgoCurrency;
  children: ReactNode;
}

export function CurrencyScope({ currency, children }: Props) {
  const [current, setCurrent] = useState<YgoCurrency>(DEFAULT_CURRENCY);

  useEffect(() => {
    setCurrent(readCurrencyCookie());
    const onChange = () => setCurrent(readCurrencyCookie());
    window.addEventListener('ygo:currency-changed', onChange);
    return () => window.removeEventListener('ygo:currency-changed', onChange);
  }, []);

  if (current !== currency) return null;
  return <>{children}</>;
}
