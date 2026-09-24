import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import styles from '../account/Account.module.css';

export const metadata: Metadata = {
  title: 'Your decks — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function DecksPage() {
  await requireUser('/decks');
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <section className={styles.section}>
          <h1 className={styles.sectionTitle}>Your decks</h1>
          <p className={styles.sectionCaption}>
            Build Main / Extra / Side decks with deterministic Forbidden &amp;
            Limited legality checks, monster-type breakdowns and estimated
            deck value.
          </p>
          <div className={styles.form}>
            <p className={styles.notice}>
              The deck builder ships in Slice F. Your account is ready — you
              can build once the builder UI arrives.
            </p>
            <Link href="/card-finder" className={styles.submit} style={{ textDecoration: 'none' }}>
              Find cards for your next deck
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
