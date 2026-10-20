'use client';

// Site-wide currency toggle. Two segmented buttons EUR | USD. Sets a
// cookie via /api/currency then (a) dispatches onepiece:currency-
// changed so ISR'd pages flip the display without a reload, and
// (b) calls router.refresh() so Dynamic routes whose server read
// the cookie re-render.
//
// CN-COST-03 B: `initial` is now optional. When omitted (ISR / Full
// Route Cache callers like the root layout), the component starts
// at DEFAULT_CURRENCY and reads the real op_currency cookie after
// mount — matching the server HTML's initial render exactly and
// avoiding hydration mismatch.

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  OP_CURRENCIES,
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

export function CurrencyToggle({ initial }: { initial?: OpCurrency }) {
  const router = useRouter();
  // Start at `initial` when a Dynamic caller supplied one, else
  // DEFAULT_CURRENCY so the first client render matches the server
  // HTML (which cannot see document.cookie). The real cookie is
  // read in the useEffect below, so an EUR-cookie visitor on an
  // ISR'd page sees one frame of DEFAULT before the toggle snaps.
  const [current, setCurrent] = useState<OpCurrency>(initial ?? DEFAULT_CURRENCY);
  const [pending, start] = useTransition();

  useEffect(() => {
    // Only override from the cookie when the caller did NOT already
    // pass `initial`. Dynamic routes' servers resolved the cookie
    // themselves and know better than we do here.
    if (initial !== undefined) return;
    setCurrent(readCurrencyCookie());
    const onChange = () => setCurrent(readCurrencyCookie());
    window.addEventListener('onepiece:currency-changed', onChange);
    return () => window.removeEventListener('onepiece:currency-changed', onChange);
  }, [initial]);

  function pick(c: OpCurrency) {
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
        // Revert visually if the server rejected the change.
        setCurrent(current);
        return;
      }
      // Fire the window event so ISR'd pages (TreatmentPrice and
      // any other cookie-aware island) flip currency without a
      // reload. router.refresh() stays for Dynamic routes whose
      // server read the cookie via getCurrencyPreference().
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('onepiece:currency-changed'));
      }
      router.refresh();
    });
  }

  return (
    <div
      role="group"
      aria-label="Currency"
      style={{
        display: 'inline-flex',
        borderRadius: 999,
        border: '1px solid var(--border-strong, var(--border))',
        background: 'var(--surface)',
        overflow: 'hidden',
        height: 32,
        flexShrink: 0,
        opacity: pending ? 0.7 : 1,
      }}
    >
      {OP_CURRENCIES.map((c) => {
        const active = c === current;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            onClick={() => pick(c)}
            style={{
              padding: '0 12px',
              height: '100%',
              border: 'none',
              background: active ? 'var(--gold-300)' : 'transparent',
              color: active ? 'var(--palette-navy)' : 'var(--text-muted)',
              fontFamily: 'inherit',
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.06em',
              cursor: pending ? 'wait' : 'pointer',
              transition: 'background 120ms, color 120ms',
            }}
          >
            {c}
          </button>
        );
      })}
    </div>
  );
}
