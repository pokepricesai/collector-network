'use client';

// Site-wide currency toggle. Segmented USD | EUR. Sets a first-party
// cookie via /api/currency then refreshes the current route so every
// server component re-reads pricing in the selected currency. Default
// is USD for new visitors (see currency.ts).

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { YGO_CURRENCIES, type YgoCurrency } from '@/lib/currency';
import styles from './CurrencyToggle.module.css';

export function CurrencyToggle({ initial }: { initial: YgoCurrency }) {
  const router = useRouter();
  const [current, setCurrent] = useState<YgoCurrency>(initial);
  const [pending, start] = useTransition();

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
        setCurrent(initial);
        return;
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
