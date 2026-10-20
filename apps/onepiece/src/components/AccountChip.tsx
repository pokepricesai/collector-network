'use client';

// Right-side navbar auth slot. Client island so the root layout can
// stay static and every public page can be classified as
// prerender-able (CN-COST-03).
//
// Mirror of apps/lorcana/src/components/AccountChip.tsx — same
// three-state shape (loading / anon / user) with OPP-specific
// visual output (Dashboard link → /account, settings avatar →
// /settings with the user's initial).
//
// Three render states:
//   loading     — neutral width-stable shell while the session
//                 query resolves. Never flashes "Sign in" to a
//                 signed-in user.
//   signed-out  — Sign in (outlined) + Sign up (gold filled)
//   signed-in   — Dashboard (outlined, → /account) + round
//                 /settings link with the user's initial
//
// Auth state is kept live via supabase.auth.onAuthStateChange so
// signing in / out updates the chip without a full page reload.
//
// PRESENTATION ONLY. Server authorisation (protected pages,
// server actions, API routes) still re-reads the session via
// Supabase RLS. Flashing a wrong UI state would be a UX bug,
// never an authorisation hole.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserSupabase } from '@collector-network/auth';

type AuthState =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'user'; user: User };

export function AccountChip() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
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
    // Width-stable placeholder sized to roughly match the signed-out
    // Sign in + Sign up footprint so the navbar does not shift when
    // auth resolves.
    return (
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
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
    // Signed-out: show both Sign in + Sign up so the primary
    // acquisition CTA is always visible in the header. Visual output
    // matches the previous server-rendered AccountChip exactly.
    return (
      <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
        <Link
          href="/sign-in"
          style={{
            padding: '7px 12px',
            borderRadius: 10,
            background: 'transparent',
            border: '1px solid var(--border-strong, var(--border))',
            color: 'var(--text)',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          style={{
            padding: '7px 14px',
            borderRadius: 10,
            background: 'var(--primary)',
            color: 'var(--palette-white)',
            textDecoration: 'none',
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '0.02em',
            boxShadow: '0 2px 6px rgba(9,55,134,0.20)',
          }}
        >
          Sign up
        </Link>
      </div>
    );
  }

  const user = auth.user;
  const initial =
    (user.email ?? (user.user_metadata?.['full_name'] as string | undefined) ?? 'U')
      .toString()
      .charAt(0)
      .toUpperCase() || 'U';
  return (
    <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
      <Link
        href="/account"
        style={{
          padding: '7px 12px',
          borderRadius: 10,
          background: 'transparent',
          border: '1px solid var(--border-strong, var(--border))',
          color: 'var(--text)',
          textDecoration: 'none',
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        Dashboard
      </Link>
      <Link
        href="/settings"
        aria-label="Your profile and settings"
        title="Account and settings"
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--gold-300)',
          color: 'var(--palette-navy)',
          textDecoration: 'none',
          fontFamily: 'Outfit, system-ui, sans-serif',
          fontSize: 15,
          fontWeight: 800,
          border: '1px solid var(--gold-400)',
          boxShadow: '0 2px 8px rgba(228,195,23,0.30)',
        }}
      >
        {initial}
      </Link>
    </div>
  );
}
