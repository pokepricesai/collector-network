'use client';

// Client island that owns the Header's account presentation. Lifts
// the previous server-side `getCurrentUser()` + `readYgoProfile()`
// pair out of the parent <Header /> so the Header can remain a
// synchronous server component with zero cookie dependencies.
//
// Hydration-safe pattern (mirrors Lorcana P0 AccountChip):
//   - Initial render matches the server HTML exactly: a signed-out
//     AccountMenu + no Dashboard chip. React reconciles cleanly
//     regardless of whether the real session is signed-in or
//     signed-out.
//   - useEffect reads session via createBrowserSupabase, subscribes
//     to onAuthStateChange, then re-renders with the real identity.
//     Signed-in visitors see sign-in/sign-up chips for one tick
//     before the AccountMenu + Dashboard chip appear. Signed-out
//     visitors see no change.
//
// This is PRESENTATION ONLY. Protected routes/actions still enforce
// their own server-side auth via requireUser() / middleware; nothing
// here grants access.
//
// Preserves the exact UI the server-rendered Header produced:
//   - Desktop:  [Dashboard chip (if signed in)] [AccountMenu]
//   - Mobile:   AccountMenu only (Dashboard lives in the mobile drawer)

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createBrowserSupabase } from '@collector-network/auth';
import { readYgoProfile } from '../lib/user-profile';
import { AccountMenu } from './AccountMenu';
import styles from './Header.module.css';

interface Identity {
  displayName: string;
  avatarKey: ReturnType<typeof readYgoProfile>['avatarKey'];
  photoUrl: string | null;
}

function identityFromUser(user: User): Identity {
  // readYgoProfile expects a CollectorNetworkUser; the shared type is
  // structurally compatible with supabase-js User (both carry
  // user_metadata as Record<string, unknown>). Cast is intentional —
  // the profile reader is pure in-memory and does not touch anything
  // outside user_metadata.
  const profile = readYgoProfile(user as Parameters<typeof readYgoProfile>[0]);
  const photoUrl =
    (user.user_metadata?.['avatar_url'] as string | undefined) ??
    (user.user_metadata?.['picture'] as string | undefined) ??
    null;
  return {
    displayName: profile.displayName,
    avatarKey: profile.avatarKey,
    photoUrl,
  };
}

export function AccountIsland() {
  // Match the signed-out server HTML on the first render; swap after
  // mount if a session resolves.
  const [identity, setIdentity] = useState<Identity | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setIdentity(session?.user ? identityFromUser(session.user) : null);
      })
      .catch(() => {
        /* leave as signed-out */
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setIdentity(session?.user ? identityFromUser(session.user) : null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Render exactly what the previous server Header rendered given the
  // same identity, so this is a drop-in. The Dashboard chip wraps in
  // the same desktopDashboard CSS class the Header used so mobile
  // visibility rules carry over unchanged.
  return (
    <>
      {identity && (
        <Link
          href={'/dashboard' as const}
          className={`${styles.dashboardLink} ${styles.desktopDashboard}`}
        >
          Dashboard
        </Link>
      )}
      <AccountMenu
        user={
          identity
            ? {
                displayName: identity.displayName,
                avatarKey: identity.avatarKey,
                photoUrl: identity.photoUrl,
              }
            : null
        }
      />
    </>
  );
}
