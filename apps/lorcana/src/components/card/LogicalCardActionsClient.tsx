'use client';

// Client-side actions island for /card/[slug]. Replaces the former
// server-component wiring (getCurrentUser + watchedPrintingIdsFor +
// getRequestCountry + getLorcanaCurrency) so the page can be
// classified ISR without baking per-user, per-currency, per-country
// state into the cached HTML.
//
// Mirror of the P1a ExactActionsClient pattern:
//   - initial render matches the server HTML exactly (anon
//     defaults, DEFAULT_CURRENCY, no country)
//   - useEffect resolves session via createBrowserSupabase, fetches
//     /api/geo + /api/watchlist/status-batch, then re-renders
//   - subscribes to supabase.auth.onAuthStateChange and the
//     lorcana:currency-changed window event so sign-in / sign-out
//     and currency-toggle flips update the chip without a reload
//
// Renders the EbayFindButton with the resolved marketplace plus
// the existing LogicalAddToCollection + LogicalWatch client
// components with resolved signed-in + per-printing watching props.

import { useEffect, useMemo, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import LogicalAddToCollection, {
  type PrintingPick,
} from './LogicalAddToCollection';
import LogicalWatch, { type WatchablePrinting } from './LogicalWatch';
import EbayFindButton from '../EbayFindButton';
import { resolveLorcanaMarketplace } from '../../lib/lorcana/ebay';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  isLorcanaCurrency,
  type LorcanaCurrency,
} from '../../lib/currency';

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

interface Props {
  cardName: string;
  returnPath: string;
  heroSetName: string | null;
  heroSetCode: string | null;
  heroCollectorNumber: string | null;
  printings: PrintingPick[];
}

export function LogicalCardActionsClient({
  cardName,
  returnPath,
  heroSetName,
  heroSetCode,
  heroCollectorNumber,
  printings,
}: Props) {
  const [signedIn, setSignedIn] = useState(false);
  const [currency, setCurrency] = useState<LorcanaCurrency>(DEFAULT_CURRENCY);
  const [country, setCountry] = useState<string | null>(null);
  // Watching state resolved per printing. Starts as all-false so the
  // initial render matches the server HTML (which also renders
  // all-false now that we removed the server watchedPrintingIdsFor
  // read).
  const [watchingMap, setWatchingMap] = useState<Record<string, boolean>>(
    () => Object.fromEntries(printings.map((p) => [p.printingId, false])),
  );

  const printingIdsKey = useMemo(
    () => printings.map((p) => p.printingId).sort().join(','),
    [printings],
  );

  useEffect(() => {
    setCurrency(readCurrencyCookie());

    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function resolveWatching(signedInNow: boolean) {
      if (!signedInNow || printings.length === 0) return;
      try {
        const r = await fetch('/api/watchlist/status-batch', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            printingIds: printings.map((p) => p.printingId),
          }),
        });
        if (!r.ok) return;
        const data = (await r.json()) as {
          ok: boolean;
          signedIn: boolean;
          watching?: Record<string, boolean>;
        };
        if (cancelled || !data.ok || !data.watching) return;
        setWatchingMap(data.watching);
      } catch {
        /* leave watchingMap at defaults */
      }
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        const now = !!session?.user;
        setSignedIn(now);
        void resolveWatching(now);
      })
      .catch(() => {
        /* leave signedIn=false */
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const now = !!session?.user;
      setSignedIn(now);
      // Re-resolve watching on sign-in / sign-out so the picker's
      // "Watching ✓" state reflects the new session.
      if (now) {
        void resolveWatching(true);
      } else {
        setWatchingMap(Object.fromEntries(printings.map((p) => [p.printingId, false])));
      }
    });

    fetch('/api/geo', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const raw = typeof data?.country === 'string' ? data.country : null;
        setCountry(raw);
      })
      .catch(() => {
        /* leave country=null */
      });

    const onCurrencyChange = () => setCurrency(readCurrencyCookie());
    window.addEventListener('lorcana:currency-changed', onCurrencyChange);

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.removeEventListener('lorcana:currency-changed', onCurrencyChange);
    };
    // Intentionally keyed by the stable sorted-id string so a
    // props-equivalent array doesn't re-run the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printingIdsKey]);

  const marketplace = resolveLorcanaMarketplace(country, currency);
  const watchablePrintings: WatchablePrinting[] = printings.map((p) => ({
    ...p,
    initialWatching: watchingMap[p.printingId] ?? false,
  }));

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <LogicalAddToCollection
          cardName={cardName}
          isSignedIn={signedIn}
          returnPath={returnPath}
          printings={printings}
        />
        {watchablePrintings.length > 0 ? (
          <LogicalWatch
            cardName={cardName}
            isSignedIn={signedIn}
            returnPath={returnPath}
            printings={watchablePrintings}
          />
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EbayFindButton
          cardName={cardName}
          setName={heroSetName}
          setCode={heroSetCode}
          collectorNumber={heroCollectorNumber}
          marketplace={marketplace}
          source="lorcana-card"
          size="sm"
          label={`Find ${cardName} on eBay`}
        />
      </div>
    </>
  );
}
