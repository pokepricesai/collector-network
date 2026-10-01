import Link from 'next/link';
import { SITE_NAME } from '@/lib/sites';

// Header. Compact nav; "Our Sites" anchors back to the homepage
// platform grid. Partner With Us is the primary CTA because the
// commercial journey is the point of the umbrella site. Final logo
// drops into the `.nav-wordmark` slot when Luke provides it.

export default function Header() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="nav-wordmark" aria-label={`${SITE_NAME} home`}>
          <span className="nav-wordmark-dot" aria-hidden />
          <span>{SITE_NAME}</span>
        </Link>
        <nav className="nav-links" aria-label="Primary">
          <Link href="/#platforms" className="nav-link only-desktop">Our Sites</Link>
          <Link href="/about" className="nav-link">About</Link>
          <Link href="/contact" className="nav-link only-desktop">Contact</Link>
          <Link href="/partner" className="btn btn-primary nav-cta">Partner With Us</Link>
        </nav>
      </div>
    </header>
  );
}
