import Link from 'next/link';
import { AccountIsland } from './AccountIsland';
import { SearchBar } from './SearchBar';
import { CurrencyToggle } from './CurrencyToggle';
import { MobileNavDrawer } from './MobileNavDrawer';
import styles from './Header.module.css';

interface NavItem {
  label: string;
  href: string;
}

// Primary catalogue / product routes. Owner-only surfaces
// (Collection, Watchlist, Account, Settings) live in AccountMenu.
// Decks belongs in the top nav because signed-out users can also
// browse public decks by URL and land in the library on sign-in.
const NAV: NavItem[] = [
  { label: 'Finder', href: '/card-finder' },
  { label: 'Sets', href: '/sets' },
  { label: 'Rarities', href: '/rarities' },
  { label: 'Archetypes', href: '/archetypes' },
  { label: 'Market', href: '/market' },
  { label: 'F&L', href: '/forbidden-limited' },
  { label: 'Decks', href: '/decks' },
  { label: 'Insights', href: '/insights' },
];

// Header is a synchronous server component. User identity and
// currency are owned by the AccountIsland + cookie-aware
// CurrencyToggle client islands below, so this component makes
// zero cookies()/headers()/auth calls. Keeping Header static-only
// is what unlocks the Full Route Cache for every public page that
// renders it (see YGO P02 audit).
export function Header({ compactSearch = true }: { compactSearch?: boolean }) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <Link href="/" className={styles.brand} aria-label="YGOPrices - home">
          {/* Native <img> so we do not need to configure the Next
              image loader for a local static asset. Intrinsic size is
              1400×787 (transparent PNG, black backdrop stripped);
              width/height reserve aspect ratio and prevent CLS. CSS
              caps display height per breakpoint; object-fit keeps
              proportions. Loaded with priority (fetchPriority="high")
              because it's above-the-fold on every route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/ygoprices-logo.png"
            alt="YGOPrices"
            className={styles.brandLogo}
            width={1400}
            height={787}
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
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} className={styles.navItem}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.accountSlot}>
          <div className={styles.desktopCurrency}>
            {/* No `initial` prop: CurrencyToggle starts from
                DEFAULT_CURRENCY on the server render and reads the
                ygo_currency cookie after mount. Needed to keep this
                Header free of cookies() reads. */}
            <CurrencyToggle />
          </div>
          <AccountIsland />
          <MobileNavDrawer items={NAV} />
        </div>
      </div>
    </header>
  );
}
