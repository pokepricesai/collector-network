'use client';
import Link from 'next/link';
import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// Site navigation. Primary desktop bar exposes the surfaces Lorcana
// collectors and players live in: Cards, Sets, Inks, Card Finder,
// Movers, Insights. A Tools dropdown holds secondary utilities. On
// narrower widths (below ~1280) Inks + Card Finder move into Tools.
//
// The `accountSlot` prop is populated by a server component (see
// AccountChip.tsx) so we can render authenticated state — a client
// component can't call getCurrentUser() directly.

type NavItem = { label: string; href: string };

const PRIMARY_LINKS_WIDE: NavItem[] = [
  { label: 'Cards',       href: '/cards/search' },
  { label: 'Sets',        href: '/browse' },
  { label: 'Inks',        href: '/inks' },
  { label: 'Card Finder', href: '/card-finder' },
  { label: 'Movers',      href: '/market' },
  { label: 'Insights',    href: '/insights' },
];

const PRIMARY_LINKS_MEDIUM: NavItem[] = [
  { label: 'Cards',    href: '/cards/search' },
  { label: 'Sets',     href: '/browse' },
  { label: 'Movers',   href: '/market' },
  { label: 'Insights', href: '/insights' },
];

const TOOLS_LINKS: NavItem[] = [
  { label: 'Enchanted chase', href: '/market#enchanted' },
  { label: 'Iconic overprints', href: '/market#iconic' },
  { label: 'Most valuable',   href: '/market#most-valuable' },
];

const MEDIUM_TOOLS_LINKS: NavItem[] = [
  { label: 'Inks',        href: '/inks' },
  { label: 'Card Finder', href: '/card-finder' },
  ...TOOLS_LINKS,
];

const MOBILE_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Cards & Sets',
    items: [
      { label: 'Search cards', href: '/cards/search' },
      { label: 'Browse sets',  href: '/browse' },
      { label: 'Inks',         href: '/inks' },
      { label: 'Card Finder',  href: '/card-finder' },
    ],
  },
  {
    title: 'Market',
    items: [
      { label: 'Movers',           href: '/market' },
      { label: 'Enchanted chase',  href: '/market#enchanted' },
      { label: 'Iconic overprints', href: '/market#iconic' },
      { label: 'Most valuable',    href: '/market#most-valuable' },
    ],
  },
  {
    title: 'Read',
    items: [
      { label: 'Insights', href: '/insights' },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'My Collection', href: '/collection' },
      { label: 'Account', href: '/account' },
      { label: 'Sign in', href: '/sign-in' },
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
        background: 'rgba(255,253,247,0.94)',
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
        aria-label="LorcanaPrice home"
        style={{
          display: 'flex',
          alignItems: 'center',
          textDecoration: 'none',
          flexShrink: 0,
          height: 48,
          gap: 10,
        }}
      >
        <BrandMark />
        <span
          className="lc-wordmark"
          style={{
            fontFamily: '"Outfit", ui-sans-serif, system-ui, sans-serif',
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: -0.3,
            color: 'var(--text)',
          }}
        >
          Lorcana<span style={{ color: 'var(--accent-2)' }}>Price</span>
        </span>
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
        <ToolsDropdown items={TOOLS_LINKS} />
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
        <ToolsDropdown items={MEDIUM_TOOLS_LINKS} />
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
            placeholder="Search cards, characters, sets…"
            aria-label="Search Lorcana cards"
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
              placeholder="Search cards, characters, sets…"
              aria-label="Search Lorcana cards"
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
                style={{ marginBottom: 6, color: 'var(--accent-2)' }}
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
        @media (max-width: 480px) {
          :global(.lc-wordmark) { font-size: 18px !important; }
        }
      `}</style>
    </nav>
  );
}

// Placeholder brand mark — a stylised ink-drop glyph rendered in SVG.
// The final logo lands separately; keeping it inline avoids shipping
// an OP asset with the wrong art.
function BrandMark() {
  return (
    <svg
      viewBox="0 0 32 32"
      width="32"
      height="32"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="lc-nav-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7A4EF0" />
          <stop offset="1" stopColor="#B98A3A" />
        </linearGradient>
      </defs>
      <path
        d="M16 3 C 20 10, 26 14, 26 20 A 10 10 0 1 1 6 20 C 6 14, 12 10, 16 3 Z"
        fill="url(#lc-nav-grad)"
      />
      <circle cx="12.5" cy="18" r="2.4" fill="rgba(255,255,255,0.85)" />
    </svg>
  );
}

function ToolsDropdown({ items }: { items: NavItem[] }) {
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
        className={`nav-link${open ? ' active' : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: open ? 'var(--accent-2)' : 'var(--text)',
        }}
      >
        Tools
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 220,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            boxShadow: 'var(--shadow-md)',
            padding: 6,
            zIndex: 101,
          }}
        >
          {items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: 'block',
                padding: '10px 12px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: 'inherit',
                color: 'var(--text)',
                textDecoration: 'none',
              }}
            >
              {it.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
