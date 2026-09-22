import type { FnlState } from '../design/tokens';
import { FNL_STATE_LABELS } from '../design/tokens';
import { normaliseFnl } from '../lib/fnl';
import styles from './FnlBadge.module.css';

interface FnlBadgeProps {
  state: FnlState | string | null | undefined;
}

const CLASS: Record<FnlState, string> = {
  forbidden: styles.forbidden ?? '',
  limited: styles.limited ?? '',
  'semi-limited': styles.semiLimited ?? '',
  unlimited: styles.unlimited ?? '',
  unknown: styles.unknown ?? '',
};

// Simple shape hints. Colour alone must not be the signal — each state
// also carries a distinct silhouette. Circle = restrictive, ring = quiet,
// dash = unknown.
function ShapeIcon({ state }: { state: FnlState }) {
  switch (state) {
    case 'forbidden':
      return (
        <svg
          viewBox="0 0 10 10"
          className={styles.icon}
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="5" cy="5" r="4" fill="currentColor" />
          <line x1="2" y1="2" x2="8" y2="8" stroke="var(--ygo-ink-abyss)" strokeWidth="1.5" />
        </svg>
      );
    case 'limited':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true" focusable="false">
          <rect x="1" y="4" width="8" height="2" fill="currentColor" />
        </svg>
      );
    case 'semi-limited':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true" focusable="false">
          <rect x="1" y="4" width="4" height="2" fill="currentColor" />
        </svg>
      );
    case 'unlimited':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true" focusable="false">
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
        </svg>
      );
    case 'unknown':
    default:
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true" focusable="false">
          <line x1="2" y1="5" x2="8" y2="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="1.5 1.5" />
        </svg>
      );
  }
}

export function FnlBadge({ state }: FnlBadgeProps) {
  const canonical =
    typeof state === 'string' &&
    (state === 'forbidden' ||
      state === 'limited' ||
      state === 'semi-limited' ||
      state === 'unlimited' ||
      state === 'unknown')
      ? (state satisfies FnlState)
      : normaliseFnl(state as string | null | undefined);
  const classes = [styles.badge, CLASS[canonical]].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      data-fnl={canonical}
      aria-label={`TCG legality: ${FNL_STATE_LABELS[canonical]}`}
    >
      <ShapeIcon state={canonical} />
      <span>{FNL_STATE_LABELS[canonical]}</span>
    </span>
  );
}
