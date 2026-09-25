import type { ReactNode } from 'react';
import styles from './Stat.module.css';

type StatKind =
  | 'atk'
  | 'def'
  | 'level'
  | 'rank'
  | 'link'
  | 'pendulum'
  | 'default';

interface StatProps {
  label: string;
  value: number | string | null | undefined;
  kind?: StatKind;
  size?: 'sm' | 'md' | 'lg';
  suffix?: ReactNode;
}

const KIND_CLASS: Record<StatKind, string> = {
  atk: styles.atk ?? '',
  def: styles.def ?? '',
  level: styles.level ?? '',
  rank: styles.rank ?? '',
  link: styles.link ?? '',
  pendulum: styles.pendulum ?? '',
  default: '',
};

const SIZE_CLASS: Record<'sm' | 'md' | 'lg', string> = {
  sm: styles.sm ?? '',
  md: styles.md ?? '',
  lg: styles.lg ?? '',
};

export function Stat({
  label,
  value,
  kind = 'default',
  size = 'md',
  suffix,
}: StatProps) {
  const display = value == null || value === '' ? '-' : value;
  return (
    <span
      className={[styles.stat, KIND_CLASS[kind], SIZE_CLASS[size]].filter(Boolean).join(' ')}
      data-stat-kind={kind}
    >
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>
        {display}
        {suffix}
      </span>
    </span>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <span className={styles.row}>{children}</span>;
}
