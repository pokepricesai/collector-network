import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { Surface } from '../../components/Surface';
import { GradedRankingTable, RetailRankingTable } from '../../components/market/MarketRankingTable';
import { siteUrl } from '../../lib/site-url';
import { getYugiohMarketHomeData } from '../../server/market';
import styles from '../../components/browse/Browse.module.css';

export const revalidate = 900;

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! market - most valuable printings, graded slabs, vintage highlights',
  description:
    'The current Yu-Gi-Oh! collector market at a glance. Most valuable printings, top graded slabs (exact-printing attribution only), vintage highlights. No fake trend data - only live prices from the shared catalogue.',
  alternates: { canonical: `${SITE_URL}/market` },
};

export default async function MarketHomePage() {
  const data = await getYugiohMarketHomeData();

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Market · Yu-Gi-Oh!</p>
          <h1 className={styles.title}>The Yu-Gi-Oh!&nbsp;market right now</h1>
          <p className={styles.subtitle}>
            A collector-first view of live pricing. Rankings are recomputed
            from the shared catalogue every 15 minutes. Graded prices are
            restricted to exact-printing attribution - no ambiguous
            card-scoped quotes leak into these rankings.
          </p>
          <div className={styles.notice} style={{ marginTop: 16 }}>
            No trend / momentum / percentage-change data appears anywhere on
            this page. Our forward-accumulating snapshot history is not yet
            deep enough to publish honest movers - a static &ldquo;most
            valuable right now&rdquo; view is more useful than fabricated
            gainers.
          </div>
        </header>

        {data.topRetailUsd.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Most valuable printings (USD retail)</h2>
              <Link href="/market/most-valuable" className={styles.sortLink}>
                Full ranking →
              </Link>
            </header>
            <RetailRankingTable
              entries={data.topRetailUsd.slice(0, 10)}
              currency="USD"
            />
          </section>
        )}

        {data.topGraded.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Highest-value graded slabs</h2>
              <Link href="/market/graded" className={styles.sortLink}>
                Full graded ranking →
              </Link>
            </header>
            <p className={styles.sectionCaption} style={{ marginBottom: 12 }}>
              Grade 10 slabs, printing-scoped attribution only. Card-family
              graded observations are shown on individual card pages in a
              separate panel - never mixed into these rankings.
            </p>
            <GradedRankingTable entries={data.topGraded.slice(0, 10)} />
          </section>
        )}

        {data.topVintage.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Vintage highlights</h2>
              <Link href="/market/vintage" className={styles.sortLink}>
                Full vintage ranking →
              </Link>
            </header>
            <p className={styles.sectionCaption} style={{ marginBottom: 12 }}>
              Highest-value printings from pre-Xyz sets (released before 2011).
              LOB · MRD · PSV · MFC · IOC and the classic era.
            </p>
            <RetailRankingTable
              entries={data.topVintage.slice(0, 10)}
              currency="USD"
            />
          </section>
        )}

        {data.topRetailEur.length > 0 && (
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>European market (EUR retail)</h2>
              <p className={styles.sectionCaption}>
                Currency shown as-is. USD and EUR are never converted.
              </p>
            </header>
            <RetailRankingTable
              entries={data.topRetailEur.slice(0, 8)}
              currency="EUR"
            />
          </section>
        )}

        <section className={styles.section}>
          <header className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Explore the catalogue</h2>
          </header>
          <div className={styles.directoryGrid}>
            <Link href="/sets" style={{ textDecoration: 'none' }}>
              <Surface variant="card" className={styles.directoryTile}>
                <h3 className={styles.tileTitle}>Every set</h3>
                <p className={styles.subtitle}>661 sets - boosters, structure decks, tins, promos.</p>
              </Surface>
            </Link>
            <Link href="/rarities" style={{ textDecoration: 'none' }}>
              <Surface variant="card" className={styles.directoryTile}>
                <h3 className={styles.tileTitle}>Every rarity family</h3>
                <p className={styles.subtitle}>Common through Starlight, QCSR and Prismatic families.</p>
              </Surface>
            </Link>
            <Link href="/archetypes" style={{ textDecoration: 'none' }}>
              <Surface variant="card" className={styles.directoryTile}>
                <h3 className={styles.tileTitle}>Every archetype</h3>
                <p className={styles.subtitle}>632 archetypes with member cards and set representation.</p>
              </Surface>
            </Link>
            <Link href="/forbidden-limited" style={{ textDecoration: 'none' }}>
              <Surface variant="card" className={styles.directoryTile}>
                <h3 className={styles.tileTitle}>Forbidden &amp; Limited</h3>
                <p className={styles.subtitle}>Restricted cards per catalogue metadata. TCG + OCG.</p>
              </Surface>
            </Link>
          </div>
        </section>

        {data.errors.length > 0 && (
          <details
            style={{
              marginTop: 24,
              fontFamily: 'var(--ygo-font-mono)',
              fontSize: 11,
              color: 'var(--ygo-text-quiet)',
            }}
          >
            <summary>Section-fetch errors ({data.errors.length})</summary>
            <ul>
              {data.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </details>
        )}
      </main>
      <Footer />
    </>
  );
}
