'use client';

// Watch / Watching toggle. Renders on card and printing surfaces.
// Optimistic UI: flips visual state immediately, POSTs the change,
// reverts on error. Signed-out users see a link to /sign-in.

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface Props {
  tcgCardId: string;
  tcgPrintingId: string;
  initialWatching: boolean;
  signedIn: boolean;
  currentPathname: string;
}

export function WatchButton({
  tcgCardId,
  tcgPrintingId,
  initialWatching,
  signedIn,
  currentPathname,
}: Props) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [pending, start] = useTransition();

  if (!signedIn) {
    return (
      <a
        href={`/sign-in?returnTo=${encodeURIComponent(currentPathname)}`}
        style={buttonStyle(false)}
      >
        Watch
      </a>
    );
  }

  function toggle() {
    const next = !watching;
    setWatching(next);
    start(async () => {
      try {
        const r = await fetch('/api/watchlist', {
          method: next ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tcg_card_id: tcgCardId, tcg_printing_id: tcgPrintingId }),
        });
        if (!r.ok) throw new Error('watchlist toggle failed');
      } catch {
        setWatching(!next);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={watching}
      style={buttonStyle(watching)}
    >
      {watching ? 'Watching ✓' : 'Watch'}
    </button>
  );
}

function buttonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 14px',
    borderRadius: 10,
    background: active ? 'var(--accent-2, #3a6cc4)' : 'transparent',
    color: active ? '#fff' : 'var(--text)',
    border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
    fontFamily: 'inherit',
    fontSize: 13.5,
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
  };
}
