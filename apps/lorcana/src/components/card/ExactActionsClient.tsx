'use client';

// Client-side action strip for the exact-collectible card page.
// Replaces the former async server component so the page can be
// classified ISR without baking user-specific state into cached
// HTML. Pattern mirrors AccountChip:
//   - initial render matches server HTML (defaults, no cookie read)
//   - useEffect reads currency cookie, resolves session, fetches
//     geo + watchlist status in parallel, then re-renders
//
// What moves client-side vs. what stays server:
//   - auth state           → createBrowserSupabase + onAuthStateChange
//   - watchlist status     → GET /api/watchlist/status?printingId=X
//   - currency preference  → lorcana_currency cookie read in effect
//   - request country      → GET /api/geo (soft, cache-control 300s)
// The eBay affiliate link helper is pure logic and safe to call
// client-side; marketplace resolution runs here too.

import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import { AddToCollection } from '../AddToCollection';
import { WatchButton } from '../WatchButton';
import EbayFindButton from '../EbayFindButton';
import { resolveLorcanaMarketplace } from '../../lib/lorcana/ebay';
import { slugifyCardName } from '../../lib/lorcana/slug';
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
  cardId: string;
  printingId: string;
  cardName: string;
  setName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
  rarityLabel: string | null;
  finish: string | null;
}

export function ExactActionsClient(props: Props) {
  // Hydration-safe initial state: match the server HTML exactly.
  const [signedIn, setSignedIn] = useState(false);
  const [watching, setWatching] = useState(false);
  const [currency, setCurrency] = useState<LorcanaCurrency>(DEFAULT_CURRENCY);
  const [country, setCountry] = useState<string | null>(null);

  useEffect(() => {
    setCurrency(readCurrencyCookie());

    let cancelled = false;
    const supabase = createBrowserSupabase();

    // One-shot resolve of the current session.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setSignedIn(!!session?.user);
      })
      .catch(() => {
        /* leave signedIn=false */
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session?.user);
    });

    // Watchlist status for THIS printing. The endpoint tolerates
    // signed-out and missing-table and returns watching=false.
    fetch(`/api/watchlist/status?printingId=${encodeURIComponent(props.printingId)}`, {
      credentials: 'same-origin',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.ok) return;
        setWatching(Boolean(data.watching));
      })
      .catch(() => {
        /* leave watching=false */
      });

    // Soft geo lookup for the eBay marketplace. Null is fine; the
    // resolver falls through to a currency-based default.
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
  }, [props.printingId]);

  const marketplace = resolveLorcanaMarketplace(country, currency);
  const currentPathname =
    props.setCode && props.collectorNumber
      ? `/set/${props.setCode.toLowerCase()}/card/${encodeURIComponent(
          `${props.collectorNumber}-${slugifyCardName(props.cardName)}`,
        )}`
      : '/';
  const narrowRarity =
    props.rarityLabel && /enchanted|iconic|epic|promo|super rare/i.test(props.rarityLabel)
      ? props.rarityLabel
      : null;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <AddToCollection
        cardId={props.cardId}
        printingId={props.printingId}
        cardName={props.cardName}
        isSignedIn={signedIn}
      />
      <WatchButton
        tcgCardId={props.cardId}
        tcgPrintingId={props.printingId}
        initialWatching={watching}
        signedIn={signedIn}
        currentPathname={currentPathname}
      />
      <EbayFindButton
        cardName={props.cardName}
        setName={props.setName}
        setCode={props.setCode}
        collectorNumber={props.collectorNumber}
        rarity={narrowRarity}
        finish={props.finish}
        marketplace={marketplace}
        source="lorcana-card-exact"
        size="md"
      />
    </div>
  );
}
