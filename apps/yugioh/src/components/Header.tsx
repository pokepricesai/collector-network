import Link from 'next/link';
import { SearchBar } from './SearchBar';
import styles from './Header.module.css';

interface NavItem {
  label: string;
  href?: string;
  disabled?: boolean;
}

const NAV: NavItem[] = [
  // "Cards" nav is search-first — the dedicated /cards index arrives
  // with Slice 7. For now it routes to the empty-query search page.
  { label: 'Cards', href: '/search' },
  { label: 'Sets', disabled: true },
  { label: 'Archetypes', disabled: true },
  { label: 'Market', disabled: true },
  { label: 'F&L', disabled: true },
];

export function Header({ compactSearch = true }: { compactSearch?: boolean }) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <Link href="/" className={styles.brand} aria-label="Duelist Prices — homepage (provisional name)">
          <span className={styles.brandMark}>Duelist Prices</span>
          <span className={styles.brandSub}>· provisional</span>
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
