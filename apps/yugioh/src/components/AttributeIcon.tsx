import type { CSSProperties, ReactElement } from 'react';
import type { Attribute } from '../design/tokens';
import { ATTRIBUTE_LABELS } from '../design/tokens';
import styles from './AttributeIcon.module.css';

interface AttributeIconProps {
  attribute: Attribute | string | null | undefined;
  size?: number;
  label?: 'show' | 'sr-only';
}

// Original attribute glyphs. Abstract, single-colour, no Konami assets.
// Each glyph is a 24×24 viewBox drawn with 1.5-2px strokes so it reads
// crisply at 16-24px display size.
//
// LIGHT   — radiating starburst
// DARK    — eclipse (occluded disc)
// FIRE    — angular flame
// WATER   — droplet with wave
// WIND    — spiral
// EARTH   — faceted stone
// DIVINE  — crown / halo

const GLYPHS: Record<Attribute, ReactElement> = {
  LIGHT: (
    <>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
        <line
          key={deg}
          x1="12"
          y1="4"
          x2="12"
          y2="6.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          transform={`rotate(${deg} 12 12)`}
        />
      ))}
    </>
  ),
  DARK: (
    <>
      <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17,12 A5,5 0 1,0 12,17 A7,7 0 0,1 17,12 Z" fill="currentColor" />
    </>
  ),
  FIRE: (
    <path
      d="M12,3 C13,7 17,8 15,13 C14,12 13,11 12,10 C11.5,12 9,13 9,16 C9,18.5 10.7,20 12,20 C13.3,20 15,18.5 15,16 C15,14.8 14.5,13.8 14,13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  ),
  WATER: (
    <>
      <path
        d="M12,3 C12,3 7,10 7,14 A5,5 0 0,0 17,14 C17,10 12,3 12,3 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M9,14 Q10.5,12.5 12,14 T15,14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </>
  ),
  WIND: (
    <path
      d="M18,7 C15,7 14,9 14,10.5 C14,12 15,13 16.5,13 C18,13 19,12 19,11 M6,17 C9,17 10,15 10,13.5 C10,12 9,11 7.5,11 C6,11 5,12 5,13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  ),
  EARTH: (
    <>
      <polygon
        points="12,4 20,10 17,20 7,20 4,10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="1" />
      <line x1="4" y1="10" x2="20" y2="10" stroke="currentColor" strokeWidth="1" />
    </>
  ),
  DIVINE: (
    <>
      <path
        d="M4,17 L4,10 L8,14 L12,7 L16,14 L20,10 L20,17 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="9" r="1" fill="currentColor" />
      <circle cx="12" cy="5" r="1" fill="currentColor" />
      <circle cx="16" cy="9" r="1" fill="currentColor" />
    </>
  ),
};

function toAttribute(raw: string | null | undefined): Attribute | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase();
  switch (v) {
    case 'LIGHT':
    case 'DARK':
    case 'FIRE':
    case 'WATER':
    case 'WIND':
    case 'EARTH':
    case 'DIVINE':
      return v;
    default:
      return null;
  }
}

const CLASS_BY_ATTR: Record<Attribute, string> = {
  LIGHT: styles.light ?? '',
  DARK: styles.dark ?? '',
  FIRE: styles.fire ?? '',
  WATER: styles.water ?? '',
  WIND: styles.wind ?? '',
  EARTH: styles.earth ?? '',
  DIVINE: styles.divine ?? '',
};

// Just the glyph in a disc — for use next to card names / stats.
export function AttributeIcon({ attribute, size = 20, label }: AttributeIconProps) {
  const attr = toAttribute(attribute as string | null | undefined);
  if (!attr) return null;
  const style = { '--ygo-attr-size': `${size}px` } as CSSProperties;
  const glyph = (
    <span
      className={[styles.wrap, CLASS_BY_ATTR[attr]].join(' ')}
      style={style}
      role={label === 'sr-only' ? undefined : 'img'}
      aria-label={label === 'sr-only' ? undefined : `Attribute: ${ATTRIBUTE_LABELS[attr]}`}
      data-attribute={attr}
    >
      <svg viewBox="0 0 24 24" className={styles.svg} aria-hidden="true">
        {GLYPHS[attr]}
      </svg>
    </span>
  );
  if (label === 'sr-only') {
    return (
      <>
        {glyph}
        <span className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Attribute: {ATTRIBUTE_LABELS[attr]}
        </span>
      </>
    );
  }
  return glyph;
}

// Chip variant — glyph + text label. Used on card headers.
export function AttributeChip({ attribute }: { attribute: Attribute | string | null | undefined }) {
  const attr = toAttribute(attribute as string | null | undefined);
  if (!attr) return null;
  return (
    <span
      className={[styles.chip, CLASS_BY_ATTR[attr]].join(' ')}
      data-attribute={attr}
      aria-label={`Attribute: ${ATTRIBUTE_LABELS[attr]}`}
    >
      <AttributeIcon attribute={attr} size={16} label="sr-only" />
      <span>{ATTRIBUTE_LABELS[attr]}</span>
    </span>
  );
}
