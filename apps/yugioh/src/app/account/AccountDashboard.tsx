// Server component. Compact "state of the union" for the signed-in
// user. Pulls collection + watchlist summaries, computes the top
// values via existing helpers (no new DB queries beyond the two
// list reads), and renders inline.

import Link from 'next/link';
import Image from 'next/image';
import { listCollectionForCurrentUser } from '../../server/collection';
import {
  getWatchlistCountForCurrentUser,
  listWatchlistForCurrentUser,
} from '../../server/watchlist';
import { getDeckCountForCurrentUser } from '../../server/decks';
import { computeAnalytics } from '../../lib/collection-analytics';
import styles from './AccountDashboard.module.css';

export async function AccountDashboard() {
  const [collectionResult, watchlistResult, watchlistCountResult, deckCountResult] = await Promise.all([
    listCollectionForCurrentUser(),
    listWatchlistForCurrentUser(),
    getWatchlistCountForCurrentUser(),
    getDeckCountForCurrentUser(),
  ]);

  const collectionData =
    collectionResult.ok ? collectionResult.value : null;
  const collectionMissing = !collectionResult.ok && collectionResult.reason === 'table-missing';
  const watchlistData =
    watchlistResult.ok ? watchlistResult.value : null;
  const watchlistMissing = !watchlistResult.ok && watchlistResult.reason === 'table-missing';
  const watchlistCount = watchlistCountResult.ok ? watchlistCountResult.value : 0;
  const deckInfo = deckCountResult.ok ? deckCountResult.value : { count: 0, mostRecent: null };

  const analytics = collectionData ? computeAnalytics({ items: collectionData.items }) : null;
  const mostValuable = analytics?.topMostValuable[0] ?? null;
  const recentWatched = watchlistData?.items.slice(0, 5) ?? [];

  return (
    <>
      <div className={styles.summary}>
        <div className={styles.tile}>
          <span className={styles.label}>Collection value</span>
          {collectionMissing ? (
            <>
              <span className={styles.valueMuted}>schema pending</span>
              <span className={styles.meta}>Storage being provisioned.</span>
            </>
          ) : collectionData ? (
            <>
              <span className={styles.value}>
                ${collectionData.summary.totalCurrentUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              <span className={styles.meta}>
                USD · {collectionData.summary.missingPriceCount} unpriced
              </span>
            </>
          ) : (
            <>
              <span className={styles.valueMuted}>unavailable</span>
              <span className={styles.meta}>Reload the page.</span>
            </>
          )}
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Holdings</span>
          {collectionData ? (
            <>
              <span className={styles.value}>
                {collectionData.summary.uniqueHoldings}
              </span>
              <span className={styles.meta}>
                {collectionData.summary.totalCopies} copies · {collectionData.summary.uniqueCards} unique cards
              </span>
            </>
          ) : (
            <span className={styles.valueMuted}>-</span>
          )}
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Watchlist</span>
          {watchlistMissing ? (
            <>
              <span className={styles.valueMuted}>schema pending</span>
              <span className={styles.meta}>Storage being provisioned.</span>
            </>
          ) : (
            <>
              <span className={styles.value}>{watchlistCount}</span>
              <span className={styles.meta}>watched printings</span>
            </>
          )}
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Decks</span>
          <span className={styles.value}>{deckInfo.count}</span>
          <span className={styles.meta}>
            {deckInfo.mostRecent
              ? `latest: ${deckInfo.mostRecent.name.slice(0, 40)}`
              : 'no decks yet'}
          </span>
        </div>
        <div className={styles.tile}>
          <span className={styles.label}>Most valuable</span>
          {mostValuable ? (
            <>
              <span className={styles.value}>
                ${mostValuable.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              <span className={styles.meta}>
                {mostValuable.item.card?.name ?? '-'} · ×{mostValuable.item.row.quantity}
              </span>
            </>
          ) : (
            <>
              <span className={styles.valueMuted}>none priced</span>
              <span className={styles.meta}>Add USD-priced holdings.</span>
            </>
          )}
        </div>
      </div>

      <section className={styles.recent}>
        <h2 className={styles.recentTitle}>Recently watched</h2>
        {recentWatched.length === 0 ? (
          <div className={styles.emptyList}>
            No watched cards yet. Hit ☆ Watch on any printing to start tracking it.
          </div>
        ) : (
          <div className={styles.recentList}>
            {recentWatched.map((w) => {
              const thumb =
                w.card?.images?.small ??
                w.card?.images?.normal ??
                w.card?.images?.large ??
                null;
              const cardHref =
                w.card && w.printing && w.printing.tcggraph_printing_key && w.printing.collector_number
                  ? `/card/${toSlug(w.card.name)}/printing/${encodeURIComponent(w.printing.collector_number)}/${encodeURIComponent(w.printing.tcggraph_printing_key)}`
                  : w.card
                  ? `/card/${toSlug(w.card.name)}`
                  : '/watchlist';
              return (
                <div key={w.row.id} className={styles.recentRow}>
                  {thumb ? (
                    <Image
                      src={thumb}
                      alt=""
                      width={44}
                      height={62}
                      className={styles.recentThumb}
                      unoptimized
                    />
                  ) : (
                    <div className={styles.recentThumb} aria-hidden />
                  )}
                  <div className={styles.recentBody}>
                    <Link href={cardHref} className={styles.recentName}>
                      {w.card?.name ?? '(unknown card)'}
                    </Link>
                    <div className={styles.recentMeta}>
                      {[w.set?.code?.toUpperCase(), w.printing?.collector_number, w.card?.rarity]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className={styles.recentAmount}>
                    {w.currentPrice != null && w.currentCurrency
                      ? `${w.currentCurrency === 'USD' ? '$' : '€'}${w.currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
                      : '-'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
