import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { RetailRankingTable } from '../../../components/market/MarketRankingTable';
import { siteUrl } from '../../../lib/site-url';
import { VINTAGE_CUTOFF, getYugiohVintageMostValuable } from '../../../server/market';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 900;

const SITE_URL = siteUrl();
const RANKING_LIMIT = 100;

interface PageProps {
  searchParams: Promise<{ currency?: string }>;
}

type Currency = 'USD' | 'EUR';

function isCurrency(v: string | undefined): v is Currency {
  return v === 'USD' || v === 'EUR';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { currency: rawCurrency } = await searchParams;
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'USD';
  const canonical =
    currency === 'USD'
      ? `${SITE_URL}/market/vintage`
      : `${SITE_URL}/market/vintage?currency=EUR`;
  return {
    title: `Vintage Yu-Gi-Oh! - most valuable pre-Xyz printings (${currency})`,
    description: `The highest-value printings from Yu-Gi-Oh!'s pre-Xyz era (sets released before ${VINTAGE_CUTOFF}). LOB, MRD, PSV, MFC, IOC - the classic collector market ranked by live ${currency} retail.`,
    alternates: { canonical },
  };
}

export default async function MarketVintagePage({ searchParams }: PageProps) {
  const { currency: rawCurrency } = await searchParams;
  const currency: Currency = isCurrency(rawCurrency) ? rawCurrency : 'USD';
  const entries = await getYugiohVintageMostValuable({ currency, limit: RANKING_LIMIT });

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
            <span>Vintage</span>
          </p>
          <h1 className={styles.title}>Vintage Yu-Gi-Oh! - most valuable</h1>
          <p className={styles.subtitle}>
            The highest-value printings from the pre-Xyz era: every set
            released before {VINTAGE_CUTOFF}. LOB · MRD · PSV · MFC · IOC and
            the whole classic run through STOR. Ranked by live {currency}{' '}
            retail.
          </p>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>Currency</span>
            <Link
              href="/market/vintage"
              className={`${styles.sortLink} ${currency === 'USD' ? styles.sortLinkActive : ''}`}
              aria-current={currency === 'USD' ? 'page' : undefined}
            >
              USD
            </Link>
            <Link
              href="/market/vintage?currency=EUR"
              className={`${styles.sortLink} ${currency === 'EUR' ? styles.sortLinkActive : ''}`}
              aria-current={currency === 'EUR' ? 'page' : undefined}
            >
              EUR
            </Link>
          </div>
        </header>

        {entries.length === 0 ? (
          <div className={styles.notice}>
            No vintage {currency} retail rows available right now.
          </div>
        ) : (
          <RetailRankingTable entries={entries} currency={currency} />
        )}
      </main>
      <Footer />
    </>
  );
}
