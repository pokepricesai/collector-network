'use client';

// Mobile navigation drawer for YGOPrices. The trigger (<button>) is
// rendered inline inside the Header. The overlay + <aside> panel are
// rendered through a React portal into document.body so they escape
// the Header's containing block.
//
// WHY THE PORTAL: the sticky Header has `backdrop-filter: blur(8px)`.
// Per the CSS Containment / Filter Effects specs, any ancestor with
// `backdrop-filter`, `filter`, `transform`, `perspective` or
// `contain: paint` becomes the containing block for descendants with
// `position: fixed`. Without the portal, "position: fixed" on the
// drawer anchored to the Header box (not the viewport) and the panel
// appeared clipped inside the top header strip on real mobile
// browsers. The portal lifts the overlay + panel to document.body
// where their containing block is the viewport again.

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import { createBrowserSupabase } from '@collector-network/auth';
import { SearchBar } from './SearchBar';
import { CurrencyToggle } from './CurrencyToggle';
import styles from './MobileNavDrawer.module.css';

export interface MobileNavItem {
  label: string;
  href: string;
}

interface Props {
  items: readonly MobileNavItem[];
}

export function MobileNavDrawer({ items }: Props) {
  const [open, setOpen] = useState(false);
  // Guard against hydration mismatches — the portal needs
  // document.body which only exists on the client.
  const [mounted, setMounted] = useState(false);
  // Client-resolved signed-in state. Matches the SSR'd "signed-out"
  // shell on first render; the Dashboard link appears after mount
  // if a session exists. Session resolved via createBrowserSupabase
  // so the parent Header stays free of cookies().
  const [hasUser, setHasUser] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (cancelled) return;
        setHasUser(!!session?.user);
      })
      .catch(() => {
        /* leave hasUser=false */
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasUser(!!session?.user);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Close whenever the user navigates — pathname changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while open and close on Escape. Also auto-focus
  // the first interactive element in the panel for keyboard users.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const first = panelRef.current?.querySelector<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"]), input',
    );
    first?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const drawerUi = (
    <>
      <div
        className={styles.overlay}
        role="presentation"
        onClick={() => setOpen(false)}
      />
      <aside
        id={panelId}
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Menu</span>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        <div className={styles.panelSearch}>
          <SearchBar size="sm" placeholder="Search cards, set codes, archetypes…" />
        </div>

        <nav className={styles.nav} aria-label="Primary">
          <ul className={styles.navList}>
            {items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={styles.navLink}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {hasUser && (
              <li>
                <Link
                  href="/dashboard"
                  className={styles.navLink}
                  onClick={() => setOpen(false)}
                >
                  Dashboard
                </Link>
              </li>
            )}
          </ul>
        </nav>

        <div className={styles.panelFooter}>
          <span className={styles.panelFooterLabel}>Currency</span>
          <CurrencyToggle />
        </div>
      </aside>
    </>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-controls={panelId}
        aria-expanded={open}
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.hamIcon} aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>
      {open && mounted && createPortal(drawerUi, document.body)}
    </>
  );
}
