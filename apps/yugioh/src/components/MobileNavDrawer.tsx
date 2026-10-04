'use client';

// Mobile navigation drawer for YGOPrices. Rendered inside the Header
// on viewports <900px. Server passes in the resolved nav items so the
// list stays identical to the desktop header. Houses the Search bar
// and Currency toggle too — they do not fit alongside the brand on a
// 320px viewport.

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SearchBar } from './SearchBar';
import { CurrencyToggle } from './CurrencyToggle';
import type { YgoCurrency } from '../lib/currency';
import styles from './MobileNavDrawer.module.css';

export interface MobileNavItem {
  label: string;
  href: string;
}

interface Props {
  items: readonly MobileNavItem[];
  currency: YgoCurrency;
  hasUser: boolean;
}

export function MobileNavDrawer({ items, currency, hasUser }: Props) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close whenever the user navigates — pathname changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock body scroll while open and close on Escape.
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
    // Focus the first focusable element inside the panel for a11y.
    const first = panelRef.current?.querySelector<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"]), input',
    );
    first?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
      {open && (
        <div
          className={styles.overlay}
          role="presentation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        id={panelId}
        ref={panelRef}
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
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
          <CurrencyToggle initial={currency} />
        </div>
      </aside>
    </>
  );
}
