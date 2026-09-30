'use client';

// Header account state.
// - Signed out: compact "Sign in" + "Sign up" chip pair.
// - Signed in: compact circular avatar (no name text) that opens a
//   dropdown with Dashboard, Collection, Watchlist, Decks, Settings,
//   Sign out. The primary "Dashboard" entry point lives in the main
//   header (next to this menu) — this menu is the secondary account
//   surface.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { AvatarKey } from '../lib/user-profile';
import { Avatar } from './account/Avatar';
import styles from './AccountMenu.module.css';

interface Props {
  user:
    | {
        displayName: string;
        avatarKey: AvatarKey;
        photoUrl: string | null;
      }
    | null;
}

export function AccountMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape so keyboard users can dismiss.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!user) {
    return (
      <div className={styles.loggedOut}>
        <Link href="/sign-in" className={styles.linkSecondary}>
          Sign in
        </Link>
        <Link href="/sign-up" className={styles.linkPrimary}>
          Sign up
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.triggerCircle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.displayName || 'you'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar
          avatarKey={user.avatarKey}
          size={32}
          photoUrl={user.photoUrl}
          alt={user.displayName || 'Account'}
        />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {user.displayName && (
            <div className={styles.menuHeader} aria-hidden>
              {user.displayName}
            </div>
          )}
          <Link
            href="/dashboard"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Dashboard
          </Link>
          <Link
            href="/collection"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Collection
          </Link>
          <Link
            href="/watchlist"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Watchlist
          </Link>
          <Link
            href="/decks"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Decks
          </Link>
          <hr className={styles.sep} />
          <Link
            href="/settings"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <hr className={styles.sep} />
          {/* Sign-out is a POST so a link click can't accidentally
              destroy the session (Lighthouse / robots crawls, etc). */}
          <form method="post" action="/auth/sign-out" className={styles.signOutForm}>
            <button type="submit" className={styles.signOutButton}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
