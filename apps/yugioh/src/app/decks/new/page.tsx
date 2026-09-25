import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { createDeckFormAction } from '../actions';
import styles from '../Decks.module.css';

export const metadata: Metadata = {
  title: 'New deck - YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ error?: string }>;
}

export default async function NewDeckPage({ searchParams }: Props) {
  await requireUser('/decks/new');
  const { error } = await searchParams;

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>New deck</h1>
            <p className={styles.subtitle}>
              Give your deck a name and optional description. Format is TCG
              for now - additional formats will be added as YGOPrices ingests
              their F&amp;L data.
            </p>
          </div>
          <Link
            href="/decks"
            className={styles.actionBtn}
            style={{ padding: '8px 12px', fontSize: 12 }}
          >
            ← Back
          </Link>
        </header>

        {/* Uses a Server Action so the create/redirect round-trip
            happens without a client-side JS blob. */}
        <form action={createDeckFormAction} className={styles.newForm}>
          {error && <p className={styles.error}>{error}</p>}
          <label className={styles.field}>
            <span className={styles.label}>Deck name *</span>
            <input
              type="text"
              name="name"
              required
              maxLength={120}
              className={styles.input}
              placeholder="e.g. Snake-Eye Fiendsmith"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea
              name="description"
              className={styles.textarea}
              maxLength={1000}
              placeholder="Optional. Notes about the plan, tech choices, matchups…"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Format</span>
            <input
              type="text"
              value="TCG"
              disabled
              className={styles.input}
              style={{ opacity: 0.6 }}
            />
          </label>
          <div className={styles.formActions}>
            <button type="submit" className={styles.submit}>Create deck</button>
            <span style={{ fontSize: 11.5, color: 'var(--ygo-text-quiet)' }}>
              You&apos;ll land in the builder next.
            </span>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
}
