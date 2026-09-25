import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { listCollectionForCurrentUser } from '../../server/collection';
import { CollectionClient } from './CollectionClient';
import styles from './Collection.module.css';

// Owner-only. `noindex, follow` — a personal ledger; we never want
// crawlers indexing it, but internal links out remain usable.
export const metadata: Metadata = {
  title: 'Your collection — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function CollectionPage() {
  await requireUser('/collection');
  const result = await listCollectionForCurrentUser();

  if (!result.ok && result.reason === 'table-missing') {
    return <PendingSchemaScreen />;
  }
  if (!result.ok) {
    return (
      <Shell>
        <div className={styles.errorNotice}>
          Could not load your collection right now: {result.error}. Retry in a
          moment — no data was affected.
        </div>
      </Shell>
    );
  }

  const { items, summary } = result.value;
  const hasItems = items.length > 0;

  return (
    <Shell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your collection</h1>
          <p className={styles.subtitle}>
            Every card you own. Currency is never converted; valuation
            uses the same attribution rules as the rest of YGOPrices —
            raw uses printing-scoped retail, graded uses printing-scoped
            grader/grade first, then card-scoped with an explicit label.
          </p>
        </div>
        <span className={styles.count}>
          {summary.uniqueHoldings} holdings · {summary.totalCopies} copies
        </span>
      </header>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryTile}>
          <span className={styles.summaryLabel}>Total current value</span>
          <span className={styles.summaryValue}>
            ${summary.totalCurrentUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </span>
          <span className={styles.summaryMeta}>
            USD · {summary.missingPriceCount} without a current market price
          </span>
        </div>
        <div className={styles.summaryTile}>
          <span className={styles.summaryLabel}>Acquisition cost</span>
          {summary.totalAcquisitionUsd != null ? (
            <>
              <span className={styles.summaryValue}>
                ${summary.totalAcquisitionUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </span>
              <span className={styles.summaryMeta}>USD</span>
            </>
          ) : (
            <>
              <span className={styles.summaryValueMuted}>mixed currencies</span>
              <span className={styles.summaryMeta}>
                Non-USD purchases exist — we never FX-convert.
              </span>
            </>
          )}
        </div>
        <div className={styles.summaryTile}>
          <span className={styles.summaryLabel}>Unrealised gain / loss</span>
          {summary.unrealisedUsd != null ? (
            <span
              className={`${styles.summaryValue} ${
                summary.unrealisedUsd >= 0 ? styles.gainPositive : styles.gainNegative
              }`}
            >
              {summary.unrealisedUsd >= 0 ? '+' : '−'}$
              {Math.abs(summary.unrealisedUsd).toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className={styles.summaryValueMuted}>not comparable</span>
          )}
          <span className={styles.summaryMeta}>
            Current − cost, USD only.
          </span>
        </div>
        <div className={styles.summaryTile}>
          <span className={styles.summaryLabel}>Raw vs graded</span>
          <span className={styles.summaryValue}>
            {summary.rawCount}·{summary.gradedCount}
          </span>
          <span className={styles.summaryMeta}>
            ${summary.rawValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} raw · $
            {summary.gradedValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} graded
          </span>
        </div>
      </div>

      {hasItems ? (
        <CollectionClient items={items} />
      ) : (
        <div className={styles.empty}>
          Your collection is empty. Add a card from any{' '}
          <Link href="/card-finder" className={styles.emptyLink}>
            card page
          </Link>{' '}
          — pick an exact printing on family pages, or use the button on
          a printing page for one-click add.
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
        <h1 className={styles.title}>Your collection</h1>
      </header>
      <div className={styles.pendingNotice}>
        Collections storage is being provisioned in the shared database.
        The UI here is ready — as soon as the migration lands, refresh
        this page and start adding cards.
        <br />
        <br />
        In the meantime you can{' '}
        <Link href="/card-finder" style={{ color: 'inherit', textDecoration: 'underline' }}>
          browse cards
        </Link>{' '}
        or fine-tune your profile in{' '}
        <Link href="/settings" style={{ color: 'inherit', textDecoration: 'underline' }}>
          settings
        </Link>
        .
      </div>
    </Shell>
  );
}
