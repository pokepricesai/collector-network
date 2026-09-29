'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Site navigation. Two conceptual halves:
//   - Game discovery: Cards / Sets / Leaders / Colours / Market / Insights
//   - Product / account: Dashboard + Collection (surfaced via the
//     account slot when signed in)
// The old "Tools" dropdown was hiding core surfaces (Leaders, Colours)
// behind a vague label at narrower widths; those are now first-class.

type NavItem = { label: string; href: string };

const PRIMARY_LINKS_WIDE: NavItem[] = [
  { label: 'Card Finder', href: '/card-finder' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Leaders',     href: '/leaders' },
  { label: 'Colours',     href: '/colours' },
  { label: 'Market',      href: '/market' },
  { label: 'Insights',    href: '/insights' },
];

const PRIMARY_LINKS_MEDIUM: NavItem[] = [
  { label: 'Card Finder', href: '/card-finder' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Leaders',     href: '/leaders' },
  { label: 'Market',      href: '/market' },
  { label: 'Insights',    href: '/insights' },
];

const MOBILE_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Discover',
    items: [
      { label: 'Card Finder',  href: '/card-finder' },
      { label: 'Browse sets',  href: '/browse' },
      { label: 'Leaders',      href: '/leaders' },
      { label: 'Colours',      href: '/colours' },
      { label: 'Market',       href: '/market' },
      { label: 'Insights',     href: '/insights' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Dashboard',    href: '/account' },
      { label: 'My Collection', href: '/collection' },
      { label: 'Settings',     href: '/settings' },
      { label: 'Sign in',      href: '/sign-in' },
      { label: 'Sign up',      href: '/sign-up' },
    ],
  },
];

export default function Navbar({ accountSlot }: { accountSlot?: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    router.push(`/cards/search?q=${encodeURIComponent(q)}`);
  }

  function isActive(href: string) {
    if (href === '/') return pathname === '/';
    const base = href.split('#')[0]!;
    return pathname === base || pathname.startsWith(base + '/');
  }

  return (
    <nav
      style={{
        background: 'rgba(255,255,255,0.94)',
        backdropFilter: 'saturate(1.1) blur(8px)',
        WebkitBackdropFilter: 'saturate(1.1) blur(8px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 68,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        gap: 16,
      }}
    >
      <Link
        href="/"
        aria-label="OnePiecePrices home"
        style={{
          display: 'flex',
          alignItems: 'center',
          textDecoration: 'none',
          flexShrink: 0,
          height: 48,
        }}
      >
        {/* Horizontal wordmark. Original asset ships at 720x240 (3:1);
            we render at ~50px tall in the 68px header — the wordmark
            includes the compass emblem so no separate icon is needed. */}
        <Image
          src="/logo.png"
          alt="OnePiecePrices"
          width={720}
          height={240}
          priority
          className="op-nav-logo"
          style={{ height: 44, width: 'auto' }}
        />
      </Link>

      <div
        className="desktop-nav-wide"
        style={{ display: 'none', alignItems: 'center', gap: 2, flexShrink: 0 }}
      >
        {PRIMARY_LINKS_WIDE.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`nav-link${isActive(item.href) ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
      <div
        className="desktop-nav-medium"
        style={{ display: 'none', alignItems: 'center', gap: 2, flexShrink: 0 }}
      >
        {PRIMARY_LINKS_MEDIUM.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive(item.href) ? 'page' : undefined}
            className={`nav-link${isActive(item.href) ? ' active' : ''}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <form
        onSubmit={submitSearch}
        className="nav-search"
        style={{ flex: 1, maxWidth: 320, position: 'relative' }}
      >
        <div style={{ position: 'relative' }}>
          <span
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 13,
              color: 'var(--text-muted)',
              pointerEvents: 'none',
            }}
            aria-hidden
          >
            ⌕
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cards, leaders, sets…"
            aria-label="Search One Piece cards"
            style={{
              width: '100%',
              padding: '9px 12px 9px 34px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-light)',
              color: 'var(--text)',
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </form>

      {accountSlot && (
        <div className="nav-account-slot" style={{ display: 'none', flexShrink: 0 }}>
          {accountSlot}
        </div>
      )}

      <button
        className="mobile-menu-btn"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
        style={{
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          fontSize: 18,
          cursor: 'pointer',
          padding: '6px 12px',
          borderRadius: 8,
          lineHeight: 1,
        }}
      >
        {menuOpen ? '✕' : '☰'}
      </button>

      {menuOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          style={{
            position: 'absolute',
            top: 68,
            left: 0,
            right: 0,
            background: 'var(--surface)',
            borderBottom: '1px solid var(--border)',
            padding: '16px 20px 24px',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 99,
            maxHeight: 'calc(100vh - 68px)',
            overflowY: 'auto',
          }}
        >
          <form onSubmit={submitSearch} style={{ marginBottom: 14 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cards, leaders, sets…"
              aria-label="Search One Piece cards"
              style={{
                width: '100%',
                padding: '11px 12px',
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-light)',
                color: 'var(--text)',
                fontSize: 15,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </form>

          {MOBILE_GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 20 }}>
              <div
                className="label-mono"
                style={{ marginBottom: 6, color: 'var(--gold-600)' }}
              >
                {g.title}
              </div>
              <div style={{ display: 'grid', gap: 4 }}>
                {g.items.map((it) => (
                  <Link
                    key={it.label}
                    href={it.href}
                    onClick={() => setMenuOpen(false)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      color: 'var(--text)',
                      textDecoration: 'none',
                      padding: '11px 6px',
                      fontSize: 15,
                      fontWeight: 600,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {it.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        input::placeholder { color: var(--text-muted); }
        @media (min-width: 1280px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav-wide { display: flex !important; }
          .desktop-nav-medium { display: none !important; }
          .nav-account-slot { display: flex !important; }
        }
        @media (min-width: 1080px) and (max-width: 1279px) {
          .mobile-menu-btn { display: none !important; }
          .nav-search { display: block !important; }
          .desktop-nav-wide { display: none !important; }
          .desktop-nav-medium { display: flex !important; }
          .nav-account-slot { display: flex !important; }
        }
        @media (max-width: 1079px) {
          .desktop-nav-wide { display: none !important; }
          .desktop-nav-medium { display: none !important; }
          .nav-search { display: none !important; }
          .nav-account-slot { display: none !important; }
          .mobile-menu-btn { display: inline-flex !important; }
        }
        /* Shrink the header logo below 480px so the hamburger button
           and search input have room to breathe. */
        @media (max-width: 480px) {
          :global(.op-nav-logo) { height: 36px !important; }
        }
      `}</style>
    </nav>
  );
}

