import Link from 'next/link';
import { SITE_NAME, SITES } from '@/lib/sites';
import { ArrowUpRight } from './icons';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="footer-brand">
          <Link href="/" className="nav-wordmark" aria-label={`${SITE_NAME} home`}>
            <span className="nav-wordmark-dot" aria-hidden />
            <span>{SITE_NAME}</span>
          </Link>
          <p className="footer-tagline">
            Five specialist trading card platforms. One network.
          </p>
        </div>
        <div className="footer-cols">
          <div className="footer-col">
            <h4>Platforms</h4>
            <ul>
              {SITES.map((s) => (
                <li key={s.slug}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${s.name} (opens in new tab)`}
                  >
                    <span>{s.name}</span>
                    <ArrowUpRight className="ext-arrow" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="footer-col">
            <h4>Network</h4>
            <ul>
              <li><Link href="/about">About</Link></li>
              <li><Link href="/partner">Partner With Us</Link></li>
              <li><Link href="/contact">Contact</Link></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="container footer-copy">
        <span>© {year} {SITE_NAME}</span>
        <span className="subtle">
          Pokémon, Magic: The Gathering, Yu-Gi-Oh!, One Piece and Disney Lorcana are trademarks of their respective owners.
        </span>
      </div>
    </footer>
  );
}
