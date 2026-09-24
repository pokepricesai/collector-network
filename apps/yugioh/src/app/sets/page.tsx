import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../components/Footer';
import { Header } from '../../components/Header';
import { Surface } from '../../components/Surface';
import { siteUrl } from '../../lib/site-url';
import { listYugiohSetsForDirectory, type SetDirectoryEntry } from '../../server/browse';
import styles from '../../components/browse/Browse.module.css';

export const revalidate = 3600;

const SITE_URL = siteUrl();

type Sort = 'newest' | 'oldest' | 'alpha' | 'count';

export const metadata: Metadata = {
  title: 'Yu-Gi-Oh! sets — every booster, tin and structure deck',
  description:
    'Browse every Yu-Gi-Oh! set indexed in our catalogue. Newest boosters, structure decks, tins, promo packs — sortable by release date, name, or card count.',
  alternates: { canonical: `${SITE_URL}/sets` },
};

interface PageProps {
  searchParams: Promise<{ sort?: string }>;
}

const SORTS: Array<{ key: Sort; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'alpha', label: 'A → Z' },
  { key: 'count', label: 'Card count' },
];

function isSort(v: string | undefined): v is Sort {
  return v === 'newest' || v === 'oldest' || v === 'alpha' || v === 'count';
}

function applySort(entries: SetDirectoryEntry[], sort: Sort): SetDirectoryEntry[] {
  const copy = [...entries];
  copy.sort((a, b) => {
    const ra = a.set.released_at ?? '';
    const rb = b.set.released_at ?? '';
    switch (sort) {
      case 'oldest':
        return (ra || '9999').localeCompare(rb || '9999');
      case 'alpha':
        return a.set.name.localeCompare(b.set.name);
      case 'count':
        return b.uniqueCardCount - a.uniqueCardCount;
      case 'newest':
      default:
        return (rb || '0000').localeCompare(ra || '0000');
    }
  });
  return copy;
}

export default async function SetsDirectoryPage({ searchParams }: PageProps) {
  const { sort: rawSort } = await searchParams;
  const sort: Sort = isSort(rawSort) ? rawSort : 'newest';
  const entries = await listYugiohSetsForDirectory();
  const sorted = applySort(entries, sort);
  const totalUnique = entries.reduce((n, e) => n + e.uniqueCardCount, 0);
  const totalVariants = entries.reduce((n, e) => n + e.variantCount, 0);

  return (
    <>
      <Header compactSearch />
      <main className={styles.page}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>Sets · Yu-Gi-Oh!</p>
          <h1 className={styles.title}>Every Yu-Gi-Oh! set in the catalogue</h1>
          <p className={styles.subtitle}>
            {entries.length.toLocaleString('en-US')} sets ·{' '}
            {totalUnique.toLocaleString('en-US')} unique cards across{' '}
            {totalVariants.toLocaleString('en-US')} rarity variants.
            Boosters, structure decks, tins, duelist packs and promotional
            releases. Click through for the full set listing, rarity
            breakdown, and highest-value cards.
          </p>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>Sort</span>
            {SORTS.map((s) => {
              const active = s.key === sort;
              const href = s.key === 'newest' ? '/sets' : `/sets?sort=${s.key}`;
              return (
                <Link
                  key={s.key}
                  href={href}
                  className={`${styles.sortLink} ${active ? styles.sortLinkActive : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {s.label}
                </Link>
              );
            })}
          </div>
        </header>

        <div className={styles.directoryGrid}>
          {sorted.map((entry) => (
            <Link
              key={entry.set.id}
              href={`/set/${encodeURIComponent(entry.set.code.toLowerCase())}`}
              style={{ textDecoration: 'none' }}
            >
              <Surface variant="card" className={styles.directoryTile}>
                <h2 className={styles.tileTitle}>{entry.set.name}</h2>
                <div className={styles.tileMeta}>
                  <span className={styles.setCode}>
                    {entry.set.code.toUpperCase()}
                  </span>
                  <span className={styles.tileMetaValue}>
                    {entry.set.released_at
                      ? new Date(entry.set.released_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                        })
                      : '—'}
                  </span>
                </div>
                <div className={styles.tileMeta}>
                  <span>Unique cards</span>
                  <span className={styles.tileMetaValue}>
                    {entry.uniqueCardCount.toLocaleString('en-US')}
                  </span>
                </div>
                <div className={styles.tileMeta}>
                  <span>Rarity variants</span>
                  <span className={styles.tileMetaValue}>
                    {entry.variantCount.toLocaleString('en-US')}
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
