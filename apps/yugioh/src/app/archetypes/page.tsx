import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { Surface } from '../../components/Surface';
import { siteUrl } from '../../lib/site-url';
import { listYugiohArchetypesForDirectory } from '../../server/browse';
import styles from '../../components/browse/Browse.module.css';

// 1h ISR — the underlying archetype scan is slow (~15s cold across
// 38k cards). Every warm hit is instant off the cache.
export const revalidate = 3600;

const SITE_URL = siteUrl();

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! archetypes - every named strategy in the catalogue',
  description:
    'Every Yu-Gi-Oh! archetype represented in the catalogue - from Blue-Eyes and Sky Striker to Snake-Eye, Purrely, Kashtira, Branded and beyond. Cards, sets, and market values per archetype.',
  alternates: { canonical: `${SITE_URL}/archetypes` },
};

export default async function ArchetypesDirectoryPage() {
  const entries = await listYugiohArchetypesForDirectory();
  const totalCards = entries.reduce((n, e) => n + e.cardCount, 0);

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Archetypes · Yu-Gi-Oh!</p>
          <h1 className={styles.title}>Yu-Gi-Oh! archetypes</h1>
          <p className={styles.subtitle}>
            {entries.length.toLocaleString('en-US')} named archetypes across{' '}
            {totalCards.toLocaleString('en-US')} card memberships. Sorted by
            catalogue depth. Open any archetype to see member cards, set
            representation, banlist status and market values.
          </p>
        </header>

        <div className={styles.directoryGrid}>
          {entries.map((entry) => (
            <Link
              key={entry.slug}
              href={`/archetype/${entry.slug}`}
              style={{ textDecoration: 'none' }}
            >
              <Surface variant="card" className={styles.directoryTile}>
                <h2 className={styles.tileTitle}>{entry.name}</h2>
                <div className={styles.tileMeta}>
                  <span>Cards indexed</span>
                  <span className={styles.tileMetaValue}>
                    {entry.cardCount.toLocaleString('en-US')}
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
