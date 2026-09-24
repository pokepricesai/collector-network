import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@collector-network/auth';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import styles from '../account/Account.module.css';

export const metadata: Metadata = {
  title: 'Your watchlist — YGOPrices',
  robots: { index: false, follow: true },
};

export const dynamic = 'force-dynamic';

export default async function WatchlistPage() {
  await requireUser('/watchlist');
  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <section className={styles.section}>
          <h1 className={styles.sectionTitle}>Your watchlist</h1>
          <p className={styles.sectionCaption}>
            Follow cards you don&apos;t yet own. Live price, 7D / 30D / 90D
            movement and F&amp;L status in one view.
          </p>
          <div className={styles.form}>
            <p className={styles.notice}>
              The watchlist ships in Slice E. Your account is ready — the
              watchlist UI + storage will appear here in a coming slice.
            </p>
            <Link href="/card-finder" className={styles.submit} style={{ textDecoration: 'none' }}>
              Find cards to watch
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
