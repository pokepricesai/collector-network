import styles from './GradeBadge.module.css';

interface GradeBadgeProps {
  grade: string;
}

// Grade "10" gets the gold treatment; 9.5/9/8/7 step down in visual
// weight. `ungraded` is the raw stream and must never reach this
// component — see docs/yugioh/product-spec.md §H and Slice 3 tests.
export function GradeBadge({ grade }: GradeBadgeProps) {
  if (grade === 'ungraded') return null;
  let cls = styles.gOther ?? '';
  switch (grade) {
    case '10':
      cls = styles.g10 ?? '';
      break;
    case '9.5':
      cls = styles.g95 ?? '';
      break;
    case '9':
      cls = styles.g9 ?? '';
      break;
    case '8':
      cls = styles.g8 ?? '';
      break;
    case '7':
      cls = styles.g7 ?? '';
      break;
  }
  return (
    <span
      className={[styles.badge, cls].join(' ')}
      data-grade={grade}
      aria-label={`Grade ${grade}`}
    >
      {grade}
    </span>
  );
}
