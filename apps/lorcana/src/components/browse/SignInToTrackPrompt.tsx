'use client';

// Hero-paragraph CTA: "Sign in to track completion". Visible only
// to anonymous visitors. Hidden client-side once supabase.auth
// confirms a session.
//
// Starts visible on first render so the server-rendered HTML the
// ISR cache produces (which has no cookie context) matches a signed-
// OUT shell. Signed-in visitors see the prompt for one hydration
// cycle, then it disappears. Zero cross-user leakage: this component
// never reads or writes user state into the shared cache.

import { useEffect, useState } from 'react';
import { createBrowserSupabase } from '@collector-network/auth';

export function SignInToTrackPrompt() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setVisible(!session?.user);
      })
      .catch(() => {
        /* leave visible */
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setVisible(!session?.user);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!visible) return null;
  return (
    <>
      {' '}
      <a href="/sign-in?returnTo=/browse" style={{ color: 'var(--primary)' }}>
        Sign in to track completion
      </a>
      .
    </>
  );
}
