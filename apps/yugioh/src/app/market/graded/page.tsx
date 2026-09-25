import type { Metadata } from 'next';
import Link from 'next/link';
import { Footer } from '../../../components/Footer';
import { Header } from '../../../components/Header';
import { GradedRankingTable } from '../../../components/market/MarketRankingTable';
import { siteUrl } from '../../../lib/site-url';
import { getYugiohMostValuableGraded } from '../../../server/market';
import styles from '../../../components/browse/Browse.module.css';

export const revalidate = 900;

const SITE_URL = siteUrl();
const RANKING_LIMIT = 100;

interface PageProps {
  searchParams: Promise<{ grader?: string; grade?: string }>;
}

const GRADERS = ['psa', 'bgs', 'cgc', 'sgc'] as const;
type GraderFilter = (typeof GRADERS)[number] | 'all';

function isGraderFilter(v: string | undefined): v is GraderFilter {
  return v === 'all' || (GRADERS as readonly string[]).includes(v ?? '');
}

export const metadata: Metadata = {
  title: 'Most valuable graded Yu-Gi-Oh! slabs - printing-scoped attribution only',
  description:
    'Highest-value graded Yu-Gi-Oh! slabs from the catalogue. PSA / BGS / CGC / SGC grade 10, printing-scoped attribution only. Card-family graded observations are shown separately on card pages.',
  alternates: { canonical: `${SITE_URL}/market/graded` },
};

export default async function MarketGradedPage({ searchParams }: PageProps) {
  const { grader: rawGrader } = await searchParams;
  const graderFilter: GraderFilter = isGraderFilter(rawGrader) ? rawGrader : 'all';

  const allEntries = await getYugiohMostValuableGraded({
    limit: RANKING_LIMIT * 3,
    minPrice: 100,
    onlyGrade10: true,
  });
  const entries =
    graderFilter === 'all'
      ? allEntries.slice(0, RANKING_LIMIT)
      : allEntries.filter((e) => e.quote.grader === graderFilter).slice(0, RANKING_LIMIT);

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
            <span>Graded</span>
          </p>
          <h1 className={styles.title}>Highest-value graded slabs</h1>
          <p className={styles.subtitle}>
            Grade 10 slabs across every graded printing in the catalogue. Only
            attribution=&quot;printing&quot; quotes appear here - the ambiguous
            card-scoped graded market is shown on individual card pages in a
            clearly labelled separate panel.
          </p>
          <div className={styles.sortRow}>
            <span className={styles.sortLabel}>Grader</span>
            <Link
              href="/market/graded"
              className={`${styles.sortLink} ${graderFilter === 'all' ? styles.sortLinkActive : ''}`}
              aria-current={graderFilter === 'all' ? 'page' : undefined}
            >
              All
            </Link>
            {GRADERS.map((g) => (
              <Link
                key={g}
                href={`/market/graded?grader=${g}`}
                className={`${styles.sortLink} ${graderFilter === g ? styles.sortLinkActive : ''}`}
                aria-current={graderFilter === g ? 'page' : undefined}
              >
                {g.toUpperCase()}
              </Link>
            ))}
          </div>
        </header>

        {entries.length === 0 ? (
          <div className={styles.notice}>
            No graded rows for this filter right now.
          </div>
        ) : (
          <GradedRankingTable entries={entries} />
        )}
      </main>
      <Footer />
    </>
  );
}
