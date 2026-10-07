'use client';

// Client wrapper that resolves auth state + current watch status
// after hydration. Previously an async server component that
// called getCurrentUser() + isWatchingPrinting() with user-scoped
// data baked into the server HTML — see YGO P0-5. Making this
// client-side is what unlocks the Full Route Cache on the public
// card + printing routes while keeping each viewer's actual watch
// state out of the ISR snapshot.
//
// PRESENTATION ONLY. The watchlist mutation server actions in
// src/app/watchlist/actions.ts re-check the session via Supabase
// RLS. The `isSignedIn` prop + `initiallyWatchingId` below are UX
// hints, not authorization.
//
// Private watch state is fetched from GET /api/watchlist/status
// (Cache-Control: private, no-store) only AFTER the shared session
// hook resolves to signed-in. Anonymous visitors never trigger this
// fetch.

import { useEffect, useState } from 'react';
import { useYgoSession } from '../hooks/useYgoSession';
import { WatchButton, type PrintingOption } from './WatchButton';

interface Props {
  currentPathname: string;
  cardId: string;
  cardName: string;
  fixedPrinting?: PrintingOption;
  availablePrintings?: PrintingOption[];
}

export function WatchButtonMount(props: Props) {
  const { status } = useYgoSession();
  const isSignedIn = status === 'signed-in';
  const [initiallyWatchingId, setInitiallyWatchingId] = useState<string | null>(null);

  useEffect(() => {
    // Only query the private endpoint once the user is actually
    // signed in and we're on a printing page where a fixed printing
    // is attached. Card-family pages without a fixed printing use
    // the picker flow and don't need an initial state.
    if (!isSignedIn || !props.fixedPrinting) {
      setInitiallyWatchingId(null);
      return;
    }
    let cancelled = false;
    const printingId = props.fixedPrinting.id;
    fetch(`/api/watchlist/status?printingId=${encodeURIComponent(printingId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ok: boolean; watching?: boolean } | null) => {
        if (cancelled) return;
        setInitiallyWatchingId(data?.ok && data.watching ? printingId : null);
      })
      .catch(() => {
        if (!cancelled) setInitiallyWatchingId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, props.fixedPrinting]);

  return (
    <WatchButton
      isSignedIn={isSignedIn}
      currentPathname={props.currentPathname}
      cardId={props.cardId}
      cardName={props.cardName}
      fixedPrinting={props.fixedPrinting}
      availablePrintings={props.availablePrintings}
      initiallyWatchingId={initiallyWatchingId}
    />
  );
}
