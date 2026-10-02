'use client';

// Persistent site selector. Lives in the top bar.
//
// URL model: site context sits in the pathname — /admin/sites/[slug]
// for site-scoped pages, /admin for network-scoped overview. The
// switcher produces the right destination for the current module.

import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';
import type { NetworkSite } from '@/server/admin/sites';

interface Props {
  sites: NetworkSite[];
  activeSlug: string;
  pathname: string;
}

function moduleFromPath(pathname: string): string | null {
  // Returns the current module path (eg '/admin/seo'), or null for
  // network overview routes that have no site-scoped equivalent yet.
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2 || parts[0] !== 'admin') return null;
  if (parts[1] === 'sites') return null;
  return `/admin/${parts[1]}`;
}

export function SiteSwitcher({ sites, activeSlug, pathname }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = activeSlug === 'network'
    ? { slug: 'network', name: 'Network' }
    : sites.find((s) => s.slug === activeSlug) ?? { slug: 'network', name: 'Network' };

  const moduleRoot = moduleFromPath(pathname);

  const buildHref = (slug: string): string => {
    if (slug === 'network') return moduleRoot ?? '/admin';
    return `/admin/sites/${slug}`;
  };

  return (
    <div className="admin-site-switcher" ref={ref}>
      <button
        type="button"
        className="admin-site-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="admin-site-switcher-eyebrow">Scope</span>
        <span className="admin-site-switcher-name">{active.name}</span>
        <span aria-hidden className="admin-site-switcher-chev">▾</span>
      </button>
      {open && (
        <div className="admin-site-switcher-menu" role="menu">
          <Link
            href={moduleRoot ?? '/admin'}
            className={`admin-site-switcher-item${activeSlug === 'network' ? ' is-active' : ''}`}
            onClick={() => setOpen(false)}
            role="menuitem"
          >
            <span>Network</span>
            <span className="admin-site-switcher-sub">All five sites</span>
          </Link>
          <div className="admin-site-switcher-sep" aria-hidden />
          {sites.map((s) => (
            <Link
              key={s.slug}
              href={buildHref(s.slug)}
              className={`admin-site-switcher-item${activeSlug === s.slug ? ' is-active' : ''}`}
              onClick={() => setOpen(false)}
              role="menuitem"
            >
              <span>{s.name}</span>
              <span className="admin-site-switcher-sub">{s.slug}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
