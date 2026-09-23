import { GradedPriceCell } from '../GradedPriceCell';
import type { GradedQuote } from '@collector-network/market-data';
import styles from './CardIdentity.module.css';

interface GradedStripProps {
  quotes: GradedQuote[];
  emptyLabel?: string;
}

// Groups quotes by (grader, grade) so we don't repeat the same slab
// multiple times. Sorts by grade desc within each grader so grade 10
// leads.
export function GradedStrip({
  quotes,
  emptyLabel = 'No graded quotes with this scope.',
}: GradedStripProps) {
  const withPrice = quotes.filter((q) => q.price != null);
  if (withPrice.length === 0) {
    return <div className={styles.emptyState}>{emptyLabel}</div>;
  }
  const byKey = new Map<string, GradedQuote>();
  for (const q of withPrice) {
    const key = `${q.grader}:${q.grade}:${q.currency}`;
    const existing = byKey.get(key);
    if (!existing || (q.updatedAt > existing.updatedAt)) byKey.set(key, q);
  }
  const gradeOrder = (g: string) => {
    if (g === '10') return 100;
    if (g === '9.5') return 95;
    if (g === '9') return 90;
    if (g === '8') return 80;
    if (g === '7') return 70;
    return 0;
  };
  const graderOrder = (g: string) => {
    if (g === 'psa') return 0;
    if (g === 'bgs') return 1;
    if (g === 'cgc') return 2;
    if (g === 'sgc') return 3;
    if (g === 'any') return 9;
    return 5;
  };
  const sorted = Array.from(byKey.values()).sort((a, b) => {
    if (a.grader !== b.grader) return graderOrder(a.grader) - graderOrder(b.grader);
    return gradeOrder(b.grade) - gradeOrder(a.grade);
  });
  return (
    <div className={styles.gradedGrid}>
      {sorted.map((q) => (
        <GradedPriceCell
          key={`${q.grader}-${q.grade}-${q.currency}`}
          grader={q.grader}
          grade={q.grade}
          price={q.price}
          currency={q.currency}
          cardSalesVolume={q.cardSalesVolume}
        />
      ))}
    </div>
  );
}
