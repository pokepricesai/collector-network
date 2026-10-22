'use client';

// Client wrapper for the /browse set grid. The route itself is now
// ISR'd (CN-COST-06); the server renders every set tile with
// ownedCount = 0 and this component fills in the real per-user
// counts after the supabase session resolves.
//
// Pattern mirrors apps/lorcana/src/components/card/
// LogicalCardActionsClient.tsx — initial state matches the server
// HTML exactly so there is no hydration mismatch, then useEffect
// resolves auth, fetches /api/collection/counts-by-set when signed
// in, and re-renders.
//
// Ownership data flows ONLY through the per-user JSON endpoint
// which is served Cache-Control: private, no-store. Nothing user-
// specific is ever written into the shared ISR HTML.

import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';
import SetsGrid, { type SetTileData } from './SetsGrid';

interface Props {
  entries: SetTileData[];
}

type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'signed-in'; countsByCode: Record<string, number> };

export function BrowseGridClient({ entries }: Props) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function loadForSession(signedIn: boolean): Promise<void> {
      if (!signedIn) {
        if (!cancelled) setState({ status: 'anon' });
        return;
      }
      try {
        const r = await fetch('/api/collection/counts-by-set', {
          credentials: 'same-origin',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as {
          signedIn: boolean;
          countsByCode: Record<string, number>;
        };
        if (cancelled) return;
        setState({
          status: 'signed-in',
          countsByCode: data.signedIn ? data.countsByCode : {},
        });
      } catch {
        // Degraded: still mark signed-in so sort options light up,
        // but ownedCount stays at the server-rendered zero. Keeps
        // the UI honest about which features need auth without
        // flashing a wrong "0 of N" number.
        if (!cancelled) setState({ status: 'signed-in', countsByCode: {} });
      }
    }

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        void loadForSession(!!session?.user);
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anon' });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void loadForSession(!!session?.user);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const isSignedIn = state.status === 'signed-in';
  const countsByCode =
    state.status === 'signed-in' ? state.countsByCode : null;

  const enriched: SetTileData[] = countsByCode
    ? entries.map((e) => ({ ...e, ownedCount: countsByCode[e.code] ?? 0 }))
    : entries;

  return <SetsGrid entries={enriched} isSignedIn={isSignedIn} />;
}
