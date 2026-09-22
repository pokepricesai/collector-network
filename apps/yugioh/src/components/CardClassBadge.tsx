import type { CardClass } from '../design/tokens';
import styles from './CardClassBadge.module.css';

interface CardClassBadgeProps {
  cardClass: CardClass | string | null | undefined;
  subtype?: string | null | undefined;
}

const LABEL: Record<CardClass, string> = {
  normal: 'Normal',
  effect: 'Effect',
  ritual: 'Ritual',
  fusion: 'Fusion',
  synchro: 'Synchro',
  xyz: 'Xyz',
  pendulum: 'Pendulum',
  link: 'Link',
  spell: 'Spell',
  trap: 'Trap',
  unknown: 'Unknown',
};

const CLASS: Record<CardClass, string> = {
  normal: styles.normal ?? '',
  effect: styles.effect ?? '',
  ritual: styles.ritual ?? '',
  fusion: styles.fusion ?? '',
  synchro: styles.synchro ?? '',
  xyz: styles.xyz ?? '',
  pendulum: styles.pendulum ?? '',
  link: styles.link ?? '',
  spell: styles.spell ?? '',
  trap: styles.trap ?? '',
  unknown: styles.unknown ?? '',
};

// Original glyphs. NOT Konami's frame corners. Each class gets a
// distinct silhouette so accessibility does not rely on colour alone.
function ClassGlyph({ cardClass }: { cardClass: CardClass }) {
  switch (cardClass) {
    case 'fusion':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <circle cx="3.5" cy="5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="6.5" cy="5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'synchro':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="5" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'xyz':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <polygon points="5,1 9,9 1,9" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'pendulum':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <line x1="5" y1="0" x2="5" y2="5" stroke="currentColor" strokeWidth="1" />
          <circle cx="5" cy="7" r="2" fill="currentColor" />
        </svg>
      );
    case 'link':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <path d="M2,5 A2,2 0 0,1 4,3 L6,3 A2,2 0 0,1 8,5 A2,2 0 0,1 6,7 L4,7 A2,2 0 0,1 2,5 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'ritual':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <polygon points="5,1 9,5 5,9 1,5" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'effect':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <circle cx="5" cy="5" r="3.5" fill="currentColor" />
        </svg>
      );
    case 'normal':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" strokeWidth="1" />
        </svg>
      );
    case 'spell':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <path d="M2,5 L5,2 L8,5 L5,8 Z" fill="none" stroke="currentColor" strokeWidth="1" />
          <line x1="5" y1="2" x2="5" y2="8" stroke="currentColor" strokeWidth="0.7" />
        </svg>
      );
    case 'trap':
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <rect x="2" y="2" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
          <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="0.7" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 10 10" className={styles.icon} aria-hidden="true">
          <circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />
        </svg>
      );
  }
}

function toCardClass(raw: string | null | undefined): CardClass {
  const v = (raw ?? '').toLowerCase().trim();
  switch (v) {
    case 'normal':
    case 'effect':
    case 'ritual':
    case 'fusion':
    case 'synchro':
    case 'xyz':
    case 'pendulum':
    case 'link':
    case 'spell':
    case 'trap':
      return v;
    default:
      return 'unknown';
  }
}

export function CardClassBadge({ cardClass, subtype }: CardClassBadgeProps) {
  const canonical = toCardClass(cardClass as string | null | undefined);
  const label = subtype ? `${subtype} ${LABEL[canonical]}` : LABEL[canonical];
  const classes = [styles.badge, CLASS[canonical]].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      data-card-class={canonical}
      aria-label={`Card class: ${label}`}
    >
      <ClassGlyph cardClass={canonical} />
      <span>{label}</span>
    </span>
  );
}
