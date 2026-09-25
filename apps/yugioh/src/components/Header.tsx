import Link from 'next/link';
import { getCurrentUser } from '@collector-network/auth';
import { readYgoProfile } from '../lib/user-profile';
import { AccountMenu } from './AccountMenu';
import { SearchBar } from './SearchBar';
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
];

export async function Header({ compactSearch = true }: { compactSearch?: boolean }) {
  const user = await getCurrentUser();
  const profile = user ? readYgoProfile(user) : null;
  const photoUrl = user
    ? ((user.user_metadata?.['avatar_url'] as string | undefined) ??
      (user.user_metadata?.['picture'] as string | undefined) ??
      null)
    : null;
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <Link href="/" className={styles.brand} aria-label="YGOPrices - home">
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
          {NAV.map((item) => (
            <Link key={item.label} href={item.href} className={styles.navItem}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.accountSlot}>
          <AccountMenu
            user={
              user
                ? {
                    displayName: profile?.displayName ?? '',
                    avatarKey: profile?.avatarKey ?? 'dragon',
                    photoUrl,
                  }
                : null
            }
          />
        </div>
      </div>
    </header>
  );
}
