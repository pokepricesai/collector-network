import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { listDecksForCurrentUser } from '../../server/decks';
import { DeckLibraryActions } from './DeckLibraryActions';
import styles from './Decks.module.css';

// Private page. noindex, follow — same policy as /collection and
// /watchlist. Private routes are not in sitemaps.
export const metadata: Metadata = {
  title: 'Your decks - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function DecksPage() {
  await requireUser('/decks');
  const result = await listDecksForCurrentUser();

  if (!result.ok && result.reason === 'table-missing') return <PendingSchemaScreen />;
  if (!result.ok) {
    return (
      <Shell>
        <div className={styles.error}>
          Could not load your decks right now: {result.error}. Retry in a moment.
        </div>
      </Shell>
    );
  }

  const decks = result.value;

  return (
    <Shell>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Your decks</h1>
          <p className={styles.subtitle}>
            Build Main / Extra / Side decks with deterministic
            Forbidden &amp; Limited legality. Gameplay identity is kept
            separate from collectible printing - pick a preferred
            printing per card for display and value without affecting
            legality.
          </p>
        </div>
        <Link href="/decks/new" className={styles.newBtn}>
          + New deck
        </Link>
      </header>

      {decks.length === 0 ? (
        <div className={styles.empty}>
          You have no decks yet. Hit{' '}
          <Link href="/decks/new" style={{ color: 'var(--ygo-accent-gold-strong)', textDecoration: 'underline' }}>
            + New deck
          </Link>{' '}
          to start building.
        </div>
      ) : (
        <div className={styles.grid}>
          {decks.map((d) => {
            const state = d.legality.state;
            const stateCls =
              state === 'legal'
                ? styles.stateLegal
                : state === 'incomplete'
                ? styles.stateIncomplete
                : styles.stateIllegal;
            const updated = new Date(d.deck.updated_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            });
            return (
              <div key={d.deck.id} className={styles.tile}>
                <div className={styles.tileHeader}>
                  <Link href={`/decks/${d.deck.id}`} className={styles.tileName}>
                    {d.deck.name}
                  </Link>
                  <span className={`${styles.stateBadge} ${stateCls}`}>{state}</span>
                </div>
                <div className={styles.counts}>
                  <span>Main <strong>{d.counts.main}</strong></span>
                  <span>Extra <strong>{d.counts.extra}</strong></span>
                  <span>Side <strong>{d.counts.side}</strong></span>
                </div>
                <div className={styles.footer}>
                  <div className={styles.footerLeft}>
                    <span>updated {updated}</span>
                    {d.totalValueUsd > 0 ? (
                      <span className={styles.value}>
                        ${d.totalValueUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                      </span>
                    ) : (
                      <span className={styles.valueMuted}>no value yet</span>
                    )}
                  </div>
                  <DeckLibraryActions deckId={d.deck.id} deckName={d.deck.name} />
                </div>
              </div>
            );
          })}
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
        <h1 className={styles.title}>Your decks</h1>
      </header>
      <div className={styles.pendingNotice}>
        Deck storage is being provisioned. As soon as the migration lands
        you can start building.
      </div>
    </Shell>
  );
}
