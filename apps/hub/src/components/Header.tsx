'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight } from './icons';
import { SITE_NAME } from '@/lib/sites';

// Header. Translucent, becomes subtly bordered on scroll so the hero
// isn't fighting a hard line until the user has moved past it.
// Internal nav links stay same-tab; the Partner CTA is the primary
// commercial action.

export default function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled ? 'true' : 'false'}>
      <div className="container site-header-inner">
        <Link href="/" className="nav-wordmark" aria-label={`${SITE_NAME} home`}>
          <span className="nav-wordmark-dot" aria-hidden />
          <span>{SITE_NAME}</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/#platforms" className="nav-link only-desktop">Our Sites</Link>
          <Link href="/about" className="nav-link">About</Link>
          <Link href="/contact" className="nav-link only-desktop">Contact</Link>
          <Link href="/partner" className="btn btn-primary nav-cta">
            <span>Partner With Us</span>
            <ArrowRight className="arrow" />
          </Link>
        </nav>
      </div>
    </header>
  );
}
