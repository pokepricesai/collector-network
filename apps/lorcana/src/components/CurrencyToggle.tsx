'use client';

// Site-wide currency toggle for LorcanaPrices. Segmented USD | EUR.
// Sets a first-party cookie via /api/currency then refreshes the
// current route so every server component re-reads pricing in the
// selected currency. Default is USD for new visitors.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LORCANA_CURRENCIES, type LorcanaCurrency } from '../lib/currency';
import styles from './CurrencyToggle.module.css';

export function CurrencyToggle({ initial }: { initial: LorcanaCurrency }) {
  const router = useRouter();
  const [current, setCurrent] = useState<LorcanaCurrency>(initial);
  const [pending, start] = useTransition();

  function pick(c: LorcanaCurrency) {
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
        setCurrent(initial);
        return;
      }
      // Fan out to currency-aware client islands on ISR pages
      // (TreatmentPrice, FAQ, etc.) where router.refresh() just
      // hits the cached RSC payload and would not re-render them.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('lorcana:currency-changed', { detail: { currency: c } }),
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
      {LORCANA_CURRENCIES.map((c) => {
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
