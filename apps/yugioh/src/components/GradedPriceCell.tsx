import { GradeBadge } from './GradeBadge';
import { GraderBadge } from './GraderBadge';
import styles from './GradedPriceCell.module.css';

interface GradedPriceCellProps {
  grader: string;
  grade: string;
  price: number | null;
  currency: string;
  cardSalesVolume?: number | null;
}

// A "certificate" tile for a single (grader, grade, price) observation.
// Refuses to render for raw grader observations — the raw stream must
// never pass through graded UI.
export function GradedPriceCell({
  grader,
  grade,
  price,
  currency,
  cardSalesVolume,
}: GradedPriceCellProps) {
  if (grader === 'raw' || grade === 'ungraded') return null;
  if (price == null) return null; // no fake $0 placeholders
  const highRarity = grade === '10' || grade === '9.5';
  const classes = [styles.cell, highRarity ? styles.high : ''].filter(Boolean).join(' ');
  return (
    <div className={classes} data-grader={grader} data-grade={grade}>
      <div className={styles.row}>
        <GraderBadge grader={grader} />
        <GradeBadge grade={grade} />
      </div>
      <div className={styles.row}>
        <span className={styles.price}>{price.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        <span className={styles.currency}>{currency}</span>
      </div>
      {cardSalesVolume != null && cardSalesVolume > 0 ? (
        <div className={styles.meta}>vol {cardSalesVolume.toLocaleString('en-US')}</div>
      ) : null}
    </div>
  );
}
