import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { RarityBadge } from '../../components/RarityBadge';
import { Surface } from '../../components/Surface';
import { RarityRefractorLine } from '../../components/signature/RarityRefractorLine';
import { RARITY_FAMILY_LABELS } from '../../design/tokens';
import { siteUrl } from '../../lib/site-url';
import { listYugiohRaritiesForDirectory } from '../../server/browse';
import styles from '../../components/browse/Browse.module.css';

export const revalidate = 3600;

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! rarities - every foil, Ghost, Starlight, Prismatic',
  description:
    'Every Yu-Gi-Oh! rarity family in the catalogue - Common through Ghost Rare, Starlight Rare, Quarter Century Secret Rare, Prismatic Collector’s Rare and more. Card counts and examples per family.',
  alternates: { canonical: `${SITE_URL}/rarities` },
};

export default async function RaritiesDirectoryPage() {
  const entries = await listYugiohRaritiesForDirectory();
  const totalCards = entries.reduce((n, e) => n + e.totalCards, 0);
  const familiesWithCards = entries.filter((e) => e.totalCards > 0);

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Rarities · Yu-Gi-Oh!</p>
          <h1 className={styles.title}>Yu-Gi-Oh! rarity families</h1>
          <p className={styles.subtitle}>
            {familiesWithCards.length} rarity families represented in the
            catalogue across {totalCards.toLocaleString('en-US')} card
            variants. Follow any family into a page of cards, sets, and
            representative high-value printings.
          </p>
        </header>

        <div className={styles.directoryGrid}>
          {familiesWithCards.map((entry) => (
            <Link
              key={entry.family}
              href={`/rarity/${entry.family}`}
              style={{ textDecoration: 'none' }}
            >
              <Surface variant="card" className={styles.directoryTile}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RarityBadge rarity={entry.rarities[0] ?? entry.family} showDot />
                </div>
                <RarityRefractorLine rarity={entry.rarities[0] ?? entry.family} />
                <h2 className={styles.tileTitle}>
                  {RARITY_FAMILY_LABELS[entry.family]}
                </h2>
                <div className={styles.tileMeta}>
                  <span>Cards indexed</span>
                  <span className={styles.tileMetaValue}>
                    {entry.totalCards.toLocaleString('en-US')}
                  </span>
                </div>
                <div className={styles.tileMeta}>
                  <span>Distinct rarities</span>
                  <span className={styles.tileMetaValue}>
                    {entry.rarities.length}
                  </span>
                </div>
              </Surface>
            </Link>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}
