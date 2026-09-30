import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Avatar } from '../../components/account/Avatar';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { readYgoProfile } from '../../lib/user-profile';
import { AccountDashboard } from '../account/AccountDashboard';
import styles from '../account/Account.module.css';

// Primary logged-in collector hub. Same summary tiles as /account but
// framed as "Dashboard" — the top-level entry point for a returning
// collector. /account remains as the deep account-settings surface
// linked from here. Reuses the existing AccountDashboard so we don't
// duplicate summary queries.

export const metadata: Metadata = {
  title: 'Dashboard - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser('/dashboard');
  const profile = readYgoProfile(user);
  const photoUrl =
    (user.user_metadata?.['avatar_url'] as string | undefined) ??
    (user.user_metadata?.['picture'] as string | undefined) ??
    null;

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <Avatar
            avatarKey={profile.avatarKey}
            size={72}
            photoUrl={photoUrl}
            alt={profile.displayName}
          />
          <div className={styles.identity}>
            <h1 className={styles.name}>Dashboard</h1>
            {profile.displayName && (
              <p className={styles.email}>Signed in as {profile.displayName}</p>
            )}
            {user.email && !profile.displayName && (
              <p className={styles.email}>{user.email}</p>
            )}
          </div>
        </header>

        <AccountDashboard />

        <div className={styles.grid}>
          <Link href="/collection" className={styles.tile}>
            <h2 className={styles.tileTitle}>Collection</h2>
            <p className={styles.tileMeta}>
              Every card you own, raw and graded, with live market value.
            </p>
          </Link>
          <Link href="/watchlist" className={styles.tile}>
            <h2 className={styles.tileTitle}>Watchlist</h2>
            <p className={styles.tileMeta}>
              Cards you don&apos;t yet own. Prices and 7D/30D/90D movement.
            </p>
          </Link>
          <Link href="/decks" className={styles.tile}>
            <h2 className={styles.tileTitle}>Decks</h2>
            <p className={styles.tileMeta}>
              Build Main / Extra / Side decks with deterministic F&amp;L legality.
            </p>
          </Link>
          <Link href="/account" className={styles.tile}>
            <h2 className={styles.tileTitle}>Account &amp; settings</h2>
            <p className={styles.tileMeta}>
              Profile, email, currency preference, sign out.
            </p>
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
