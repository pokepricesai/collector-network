import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { listWatchlistForCurrentUser } from '../../server/watchlist';
import { WatchlistClient } from './WatchlistClient';
import styles from './Watchlist.module.css';

// Owner-only view. noindex, follow — same policy as /collection.
export const metadata: Metadata = {
  title: 'Your watchlist - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  await requireUser('/watchlist');
  const result = await listWatchlistForCurrentUser();

  if (!result.ok && result.reason === 'table-missing') return <PendingSchemaScreen />;
  if (!result.ok) {
    return (
      <Shell>
        <div className={styles.errorNotice}>
          Could not load your watchlist right now: {result.error}. Retry in a moment.
        </div>
      </Shell>
    );
  }

  const { items } = result.value;
  const hasItems = items.length > 0;

  return (
    <Shell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your watchlist</h1>
          <p className={styles.subtitle}>
            Track cards you don&apos;t yet own. Every row pins to an exact
            printing so 7D / 30D / 90D deltas are honest - never a raw price
            compared against a graded price, never USD vs EUR, never one rarity
            vs another. Where a lookback boundary has no observation we show
            &ldquo;Not enough history&rdquo; rather than fabricate a number.
          </p>
        </div>
        <span className={styles.count}>{items.length} watched</span>
      </header>

      {hasItems ? (
        <WatchlistClient items={items} />
      ) : (
        <div className={styles.empty}>
          Your watchlist is empty. Open a{' '}
          <Link href="/card-finder" className={styles.emptyLink}>
            card page
          </Link>{' '}
          and hit <em>☆ Watch</em> on any printing to start tracking it.
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>{children}</main>
      <Footer />
    </>
  );
}

function PendingSchemaScreen() {
  return (
    <Shell>
      <header className={styles.header}>
        <h1 className={styles.title}>Your watchlist</h1>
      </header>
      <div className={styles.pendingNotice}>
        Watchlist storage is being provisioned in the shared database. As
        soon as the migration lands you can start following cards.
        <br />
        <br />
        In the meantime you can{' '}
        <Link href="/card-finder" style={{ color: 'inherit', textDecoration: 'underline' }}>
          browse cards
        </Link>{' '}
        or open your{' '}
        <Link href="/collection" style={{ color: 'inherit', textDecoration: 'underline' }}>
          collection
        </Link>
        .
      </div>
    </Shell>
  );
}
