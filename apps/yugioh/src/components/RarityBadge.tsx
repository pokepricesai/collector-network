import type { RarityFamily } from '../design/tokens';
import { normaliseRarity } from '../lib/rarity';
import styles from './RarityBadge.module.css';

interface RarityBadgeProps {
  rarity: string | null | undefined;
  size?: 'sm' | 'lg';
  showDot?: boolean;
  className?: string;
}

// Class map is a literal record so unknown families are impossible at
// runtime — TypeScript enforces we cover every family; the switch
// statement at the bottom is the single source of truth.
const CLASS_BY_FAMILY: Record<RarityFamily, string> = {
  common: styles.common ?? '',
  rare: styles.rare ?? '',
  super: styles.super ?? '',
  ultra: styles.ultra ?? '',
  ultimate: styles.ultimate ?? '',
  secret: styles.secret ?? '',
  'prismatic-secret': styles.prismaticSecret ?? '',
  ghost: styles.ghost ?? '',
  collectors: styles.collectors ?? '',
  'prismatic-collectors': styles.prismaticCollectors ?? '',
  starlight: styles.starlight ?? '',
  qcsr: styles.qcsr ?? '',
  gold: styles.gold ?? '',
  platinum: styles.platinum ?? '',
  parallel: styles.parallel ?? '',
  'short-print': styles.shortPrint ?? '',
  other: styles.other ?? '',
};

export function RarityBadge({
  rarity,
  size = 'sm',
  showDot = false,
  className,
}: RarityBadgeProps) {
  const family = normaliseRarity(rarity);
  const label = rarity?.trim() || 'Unknown rarity';
  const classes = [
    styles.badge,
    CLASS_BY_FAMILY[family],
    size === 'lg' ? styles.large : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className={classes}
      data-rarity-family={family}
      aria-label={`Rarity: ${label}`}
    >
      {showDot ? <span className={styles.dot} aria-hidden="true" /> : null}
      <span>{label}</span>
    </span>
  );
}
