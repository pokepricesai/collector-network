'use client';

// Signed-in account dropdown. Circular avatar + menu popover.
// Menu entries: Dashboard, Collection, Watchlist, Account, Settings,
// Sign out. Keeps account tools out of the primary public nav.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

interface Props {
  displayName: string;
  initial: string;
}

const MENU: { label: string; href: string }[] = [
  { label: 'Dashboard',  href: '/dashboard' },
  { label: 'Collection', href: '/collection' },
  { label: 'Watchlist',  href: '/watchlist' },
  { label: 'Account',    href: '/account' },
  { label: 'Settings',   href: '/settings' },
];

export function AccountMenu({ displayName, initial }: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }
    return;
  }, [open]);
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${displayName}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: 'var(--accent-2, #3a6cc4)',
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: 13,
          fontWeight: 700,
          border: '1px solid rgba(0,0,0,0.15)',
          cursor: 'pointer',
        }}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 220,
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border, rgba(0,0,0,0.12))',
            borderRadius: 12,
            boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0,0,0,0.16))',
            padding: 6,
            zIndex: 101,
          }}
        >
          <div
            style={{
              padding: '8px 12px 4px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--text-muted, #667)',
              maxWidth: 220,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {displayName}
          </div>
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {m.label}
            </Link>
          ))}
          <form action="/auth/sign-out" method="POST">
            <button
              type="submit"
              role="menuitem"
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '9px 12px',
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--text)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
