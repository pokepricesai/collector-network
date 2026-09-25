import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Avatar } from '../../components/account/Avatar';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { readYgoProfile } from '../../lib/user-profile';
import { AccountDashboard } from './AccountDashboard';
import styles from './Account.module.css';

export const metadata: Metadata = {
  title: 'Your account — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function AccountPage() {
  const user = await requireUser('/account');
  const profile = readYgoProfile(user);
  const created = user.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  // Google auth attaches a picture URL; use it when present.
  const photoUrl =
    (user.user_metadata?.['avatar_url'] as string | undefined) ??
    (user.user_metadata?.['picture'] as string | undefined) ??
    null;

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <Avatar avatarKey={profile.avatarKey} size={72} photoUrl={photoUrl} alt={profile.displayName} />
          <div className={styles.identity}>
            <h1 className={styles.name}>{profile.displayName || 'YGOPrices duelist'}</h1>
            {user.email && <p className={styles.email}>{user.email}</p>}
            {created && <p className={styles.metaLine}>Joined {created}</p>}
          </div>
        </header>

        <AccountDashboard />

        <div className={styles.grid}>
          <Link href="/collection" className={styles.tile}>
            <h2 className={styles.tileTitle}>My Collection</h2>
            <p className={styles.tileMeta}>
              Track every card you own, raw and graded, with live market value.
            </p>
          </Link>
          <Link href="/watchlist" className={styles.tile}>
            <h2 className={styles.tileTitle}>Watchlist</h2>
            <p className={styles.tileMeta}>
              Follow cards you don&apos;t yet own. Prices and 7D/30D/90D
              movement in one view.
            </p>
          </Link>
          <Link href="/decks" className={styles.tile}>
            <h2 className={styles.tileTitle}>My Decks</h2>
            <p className={styles.tileMeta}>
              Build Main / Extra / Side decks with deterministic F&amp;L legality.
            </p>
          </Link>
          <Link href="/settings" className={styles.tile}>
            <h2 className={styles.tileTitle}>Settings</h2>
            <p className={styles.tileMeta}>
              Display name, avatar, pricing preferences, sign out.
            </p>
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
