'use client';

// Shared client-side session hook for the YGO Mount islands.
// Replaces the per-component `await getCurrentUser()` + cookies()
// reads that were forcing every page rendering a Mount into
// Dynamic Rendering. Factored out so AddToCollectionMount,
// WatchButtonMount, AddToDeckMount (and any future island) share
// one supabase.auth subscription instead of each registering their
// own.
//
// Hydration-safe: initial return is { status: 'loading', user: null }
// which matches the server-rendered anonymous shell. The hook
// resolves the real session via createBrowserSupabase after mount
// and swaps to 'signed-in' or 'anon' accordingly.
//
// PRESENTATION ONLY. All mutations (collection / watchlist / deck)
// re-check the session server-side via Supabase RLS. Nothing here
// is trusted for authorization.

import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserSupabase } from '@collector-network/auth';

export type YgoSessionStatus = 'loading' | 'anon' | 'signed-in';

export interface YgoSession {
  status: YgoSessionStatus;
  user: User | null;
}

export function useYgoSession(): YgoSession {
  const [state, setState] = useState<YgoSession>({ status: 'loading', user: null });

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setState(
          session?.user
            ? { status: 'signed-in', user: session.user }
            : { status: 'anon', user: null },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anon', user: null });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(
        session?.user
          ? { status: 'signed-in', user: session.user }
          : { status: 'anon', user: null },
      );
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
