import type { Grader } from '../design/tokens';
import styles from './GraderBadge.module.css';

interface GraderBadgeProps {
  grader: Grader | string;
}

const LABEL: Record<Grader, string> = {
  psa: 'PSA',
  bgs: 'BGS',
  cgc: 'CGC',
  sgc: 'SGC',
  any: 'ANY',
};

const CLASS: Record<Grader, string> = {
  psa: styles.psa ?? '',
  bgs: styles.bgs ?? '',
  cgc: styles.cgc ?? '',
  sgc: styles.sgc ?? '',
  any: styles.any ?? '',
};

function toGrader(raw: string): Grader | null {
  const g = raw.toLowerCase();
  if (g === 'psa' || g === 'bgs' || g === 'cgc' || g === 'sgc' || g === 'any') {
    return g;
  }
  return null;
}

// Grader badge. Refuses to render for `raw` — the raw stream never
// passes through graded UI. Callers may enforce this at their own layer
// too; this is defence in depth.
export function GraderBadge({ grader }: GraderBadgeProps) {
  if (grader === 'raw') return null;
  const canonical = toGrader(grader);
  if (!canonical) return null;
  return (
    <span
      className={[styles.badge, CLASS[canonical]].join(' ')}
      data-grader={canonical}
      aria-label={`Grader: ${LABEL[canonical]}`}
    >
      {LABEL[canonical]}
    </span>
  );
}
