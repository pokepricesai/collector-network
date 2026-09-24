'use client';

// Header account state. When signed out: Sign in + Create account
// links. When signed in: avatar + dropdown (Collection, Decks,
// Watchlist, Account, Settings, Sign out).

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
          Create account
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar
          avatarKey={user.avatarKey}
          size={30}
          photoUrl={user.photoUrl}
          alt={user.displayName || 'Account'}
        />
        <span className={styles.triggerName}>
          {user.displayName || 'Account'}
        </span>
        <span aria-hidden className={styles.chevron}>
          ▾
        </span>
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <Link
            href="/collection"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            My Collection
          </Link>
          <Link
            href="/decks"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            My Decks
          </Link>
          <Link
            href="/watchlist"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Watchlist
          </Link>
          <hr className={styles.sep} />
          <Link
            href="/account"
            className={styles.item}
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Account
          </Link>
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
