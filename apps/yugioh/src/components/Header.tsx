import Link from 'next/link';
import { SearchBar } from './SearchBar';
import styles from './Header.module.css';

interface NavItem {
  label: string;
  href?: string;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  { label: 'Cards', href: '/search' },
  { label: 'Sets', href: '/sets' },
  { label: 'Rarities', href: '/rarities' },
  { label: 'Archetypes', href: '/archetypes' },
  { label: 'Market', href: '/market' },
  { label: 'F&L', href: '/forbidden-limited' },
];

export function Header({ compactSearch = true }: { compactSearch?: boolean }) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <Link href="/" className={styles.brand} aria-label="YGOPrices — home">
          {/* Native <img> so we do not need to configure the Next
              image loader for a local static asset. Intrinsic size is
              2172×724; width/height reserve aspect ratio and prevent
              CLS. Loaded with priority (fetchPriority="high") because
              it's above-the-fold on every route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ygoprices-logo.png"
            alt="YGOPrices"
            className={styles.brandLogo}
            width={2172}
            height={724}
            fetchPriority="high"
            decoding="async"
          />
        </Link>
        <div className={styles.searchWrap}>
          {compactSearch && (
            <SearchBar size="sm" placeholder="Search cards, set codes, archetypes…" />
          )}
        </div>
        <nav className={styles.nav} aria-label="Primary">
          {NAV.map((item) =>
            item.disabled || !item.href ? (
              <span
                key={item.label}
                className={styles.navItem}
                aria-disabled="true"
                title="Coming in a later slice"
              >
                {item.label}
              </span>
            ) : (
              <Link key={item.label} href={item.href} className={styles.navItem}>
                {item.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </header>
  );
}
