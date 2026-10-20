'use client';

// Client-side actions island for OPP /card/[slug]. Replaces the
// former server-component wiring (getCurrentUser) so the page can
// be classified ISR without baking per-user state into the cached
// HTML.
//
// Mirror of the Lorcana P1a LogicalCardActionsClient (minus the
// Watch and country-aware eBay button — OPP's card page uses
// per-TreatmentPanel eBay links instead):
//   - initial render matches the server HTML exactly
//     (isSignedIn=false)
//   - useEffect resolves session via createBrowserSupabase and
//     re-renders when it comes back
//   - subscribes to supabase.auth.onAuthStateChange so sign-in /
//     sign-out flips the chip without a reload
//
// PRESENTATION ONLY. All mutations (collection) re-check the
// session server-side via Supabase RLS. Nothing here is trusted
// for authorization.

import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import LogicalAddToCollection, {
  type PrintingPick,
} from './LogicalAddToCollection';

interface Props {
  cardName: string;
  returnPath: string;
  printings: PrintingPick[];
}

export function LogicalCardActionsClient({ cardName, returnPath, printings }: Props) {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

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

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return (
    <LogicalAddToCollection
      cardName={cardName}
      isSignedIn={signedIn}
      returnPath={returnPath}
      printings={printings}
    />
  );
}
