import type { ReactNode } from 'react';
import styles from './DuelDivider.module.css';

interface DuelDividerProps {
  label?: ReactNode;
}

export function DuelDivider({ label }: DuelDividerProps) {
  return (
    <div className={styles.divider} role="separator" aria-orientation="horizontal">
      <span className={styles.line} aria-hidden="true" />
      {label != null && <span className={styles.label}>{label}</span>}
      <span className={styles.notch} aria-hidden="true" />
      {label != null && <span className={styles.line} aria-hidden="true" />}
    </div>
  );
}
