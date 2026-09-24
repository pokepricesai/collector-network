import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import styles from '../account/Account.module.css';

export const metadata: Metadata = {
  title: 'Your collection — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function CollectionPage() {
  await requireUser('/collection');
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <section className={styles.section}>
          <h1 className={styles.sectionTitle}>Your collection</h1>
          <p className={styles.sectionCaption}>
            Track every card you own — exact printings, raw and graded copies,
            purchase price, condition. Analytics for value, gain/loss and
            rarity/set breakdowns.
          </p>
          <div className={styles.form}>
            <p className={styles.notice}>
              Collections ship in Slice D. Your account is ready — the
              collection UI + storage will appear here in the next slice.
            </p>
            <Link href="/card-finder" className={styles.submit} style={{ textDecoration: 'none' }}>
              Browse cards in the meantime
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
