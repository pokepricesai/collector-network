'use client';

// Right-side navbar slot. Client island so the root layout stays
// static and every public page can be classified as prerender-able.
// Reads the already-browser-visible currency cookie synchronously
// on mount (no new source of truth), and resolves the Supabase
// session via @supabase/ssr's browser client.
//
// Three render states:
//   loading     — neutral width-stable shell while the session query
//                 resolves. Never flashes a confidently wrong auth
//                 state (e.g. "Sign in" for an authenticated user).
//   signed-out  — [ CurrencyToggle ]  Sign in  Sign up
//   signed-in   — [ CurrencyToggle ]  Dashboard  [avatar-dropdown]
//
// Auth state is kept live via supabase.auth.onAuthStateChange so
// signing in / out updates the chip without a full page reload.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserSupabase } from '@collector-network/auth';
import {
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY,
  isLorcanaCurrency,
  type LorcanaCurrency,
} from '../lib/currency';
import { AccountMenu } from './AccountMenu';
import { CurrencyToggle } from './CurrencyToggle';

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

type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'user'; user: User };

export function AccountChip() {
  // Currency is read from the cookie — the same source of truth the
  // server previously consulted. useState initializer runs once per
  // mount so there is no flash of the wrong currency.
  const [currency, setCurrency] = useState<LorcanaCurrency>(() =>
    readCurrencyCookie(),
  );
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    // Re-read on mount in case the SSR snapshot and the live cookie
    // disagreed (document was not defined during SSR).
    setCurrency(readCurrencyCookie());

    let cancelled = false;
    const supabase = createBrowserSupabase();

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setAuth(
          session?.user
            ? { status: 'user', user: session.user }
            : { status: 'anon' },
        );
      })
      .catch(() => {
        if (!cancelled) setAuth({ status: 'anon' });
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(
        session?.user
          ? { status: 'user', user: session.user }
          : { status: 'anon' },
      );
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (auth.status === 'loading') {
    // Neutral shell: currency toggle (safe to render — it reads the
    // same cookie), plus a width-stable placeholder sized to roughly
    // match the signed-out "Sign in / Sign up" footprint so the
    // navbar does not shift when auth resolves.
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <CurrencyToggle initial={currency} />
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 140,
            height: 32,
            borderRadius: 10,
          }}
        />
      </div>
    );
  }

  if (auth.status === 'anon') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <CurrencyToggle initial={currency} />
        <Link
          href="/sign-in"
          className="nav-link"
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            color: 'var(--text)',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          style={{
            padding: '8px 14px',
            borderRadius: 10,
            background: 'var(--primary, #6A43BE)',
            color: '#fff',
            textDecoration: 'none',
            fontSize: 13.5,
            fontWeight: 700,
            border: '1px solid transparent',
          }}
        >
          Sign up
        </Link>
      </div>
    );
  }

  const user = auth.user;
  const displayName =
    (user.user_metadata?.['full_name'] as string | undefined) ??
    (user.user_metadata?.['name'] as string | undefined) ??
    user.email ??
    'Account';
  const initial = String(displayName).trim().charAt(0).toUpperCase() || 'U';

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <CurrencyToggle initial={currency} />
      <Link
        href="/dashboard"
        style={{
          padding: '7px 14px',
          borderRadius: 10,
          background: 'var(--primary, #6A43BE)',
          color: '#fff',
          textDecoration: 'none',
          fontSize: 13.5,
          fontWeight: 700,
          border: '1px solid transparent',
        }}
      >
        Dashboard
      </Link>
      <AccountMenu displayName={displayName} initial={initial} />
    </div>
  );
}
