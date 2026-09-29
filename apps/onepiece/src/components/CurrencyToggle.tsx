'use client';

// Site-wide currency toggle. Two segmented buttons EUR | USD. Sets a
// cookie via /api/currency then refreshes the current route so every
// server component re-reads pricing in the selected currency.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { OP_CURRENCIES, type OpCurrency } from '@/lib/onepiece/currency';

export function CurrencyToggle({ initial }: { initial: OpCurrency }) {
  const router = useRouter();
  const [current, setCurrent] = useState<OpCurrency>(initial);
  const [pending, start] = useTransition();

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
