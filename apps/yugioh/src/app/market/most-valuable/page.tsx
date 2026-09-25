import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { RetailRankingTable } from '../../../components/market/MarketRankingTable';
import { siteUrl } from '../../../lib/site-url';
import { getYugiohMostValuableRetail } from '../../../server/market';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 900;

const SITE_URL = siteUrl();
const RANKING_LIMIT = 100;

type Currency = 'USD' | 'EUR';

interface PageProps {
  searchParams: Promise<{ currency?: string }>;
}

function isCurrency(v: string | undefined): v is Currency {
  return v === 'USD' || v === 'EUR';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { currency: rawCurrency } = await searchParams;
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'USD';
  const canonical =
    currency === 'USD'
      ? `${SITE_URL}/market/most-valuable`
      : `${SITE_URL}/market/most-valuable?currency=EUR`;
  return {
    title: `Most valuable Yu-Gi-Oh! printings - ${currency} retail ranking`,
    description: `Top ${RANKING_LIMIT} highest-priced Yu-Gi-Oh! printings by current ${currency} retail. Every row links to the exact printing and card page.`,
    alternates: { canonical },
  };
}

export default async function MostValuablePage({ searchParams }: PageProps) {
  const { currency: rawCurrency } = await searchParams;
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'USD';
  const entries = await getYugiohMostValuableRetail({ currency, limit: RANKING_LIMIT });

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.crumbs}>
            <Link href="/">Home</Link>
            <span className={styles.crumbSep}>·</span>
            <Link href="/market">Market</Link>
            <span className={styles.crumbSep}>·</span>
            <span>Most valuable</span>
          </p>
          <h1 className={styles.title}>Most valuable Yu-Gi-Oh! printings</h1>
          <p className={styles.subtitle}>
            The current top-{RANKING_LIMIT} Yu-Gi-Oh! printings by live {currency} retail.
            Recomputed every 15 minutes from the shared catalogue. Every row
            links to the exact printing page for graded values and other
            printings.
          </p>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>Currency</span>
            <Link
              href="/market/most-valuable"
              className={`${styles.sortLink} ${currency === 'USD' ? styles.sortLinkActive : ''}`}
              aria-current={currency === 'USD' ? 'page' : undefined}
            >
              USD
            </Link>
            <Link
              href="/market/most-valuable?currency=EUR"
              className={`${styles.sortLink} ${currency === 'EUR' ? styles.sortLinkActive : ''}`}
              aria-current={currency === 'EUR' ? 'page' : undefined}
            >
              EUR
            </Link>
          </div>
        </header>

        {entries.length === 0 ? (
          <div className={styles.notice}>
            No live {currency} retail rows available right now. Try again in a moment.
          </div>
        ) : (
          <RetailRankingTable entries={entries} currency={currency} />
        )}
      </main>
      <Footer />
    </>
  );
}
