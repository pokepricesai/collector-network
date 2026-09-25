import type { AvatarKey } from '../../lib/user-profile';
import styles from './Avatar.module.css';

interface Props {
  avatarKey: AvatarKey;
  size?: number;
  photoUrl?: string | null;
  alt?: string;
}

// Original YGO-flavoured avatars. Simple SVG glyphs — dragon curl,
// spellcaster hat, trap frame, spell frame, star, eye, card stack.
// Deliberately abstract; no copyrighted character art.
export function Avatar({
  avatarKey,
  size = 40,
  photoUrl,
  alt = 'Avatar',
}: Props) {
  if (photoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={alt}
        width={size}
        height={size}
        className={styles.photo}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`${styles.wrap} ${styles[`k-${avatarKey}`]}`}
      style={{ width: size, height: size }}
      aria-label={alt}
    >
      <AvatarSvg avatarKey={avatarKey} />
    </span>
  );
}

function AvatarSvg({ avatarKey }: { avatarKey: AvatarKey }) {
  const stroke = 'currentColor';
  switch (avatarKey) {
    case 'dragon':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Dragon curl */}
          <path
            d="M8 26 Q12 12 22 12 Q30 12 32 20 Q32 26 26 27 Q24 22 21 22 Q17 22 17 26 Q17 30 22 30 Q27 30 30 27"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="25" cy="18" r="1.4" fill={stroke} />
        </svg>
      );
    case 'spellcaster':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Wizard hat + star */}
          <path
            d="M20 8 L28 26 L12 26 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <path
            d="M11 27 L29 27 Q30 30 27 30 L13 30 Q10 30 11 27 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2"
            strokeLinejoin="round"
          />
          <path
            d="M20 14 L21.4 16.6 L24.2 17 L22.1 18.9 L22.6 21.7 L20 20.3 L17.4 21.7 L17.9 18.9 L15.8 17 L18.6 16.6 Z"
            fill={stroke}
          />
        </svg>
      );
    case 'trap':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Trap-card frame */}
          <rect x="8" y="8" width="24" height="24" rx="2" fill="none" stroke={stroke} strokeWidth="2.2" />
          <path d="M12 20 L20 12 L28 20 L20 28 Z" fill="none" stroke={stroke} strokeWidth="1.6" />
        </svg>
      );
    case 'spell':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Spell-card frame + swirl */}
          <rect x="8" y="8" width="24" height="24" rx="2" fill="none" stroke={stroke} strokeWidth="2.2" />
          <path
            d="M14 26 Q14 14 26 14 M20 14 Q26 14 26 20 M20 20 Q20 26 26 26"
            fill="none"
            stroke={stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'star':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          <path
            d="M20 6 L24 15.6 L34 16.6 L26 23 L28.4 33 L20 27.6 L11.6 33 L14 23 L6 16.6 L16 15.6 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'eye':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Millennium-inspired eye glyph - deliberately abstract */}
          <path
            d="M6 20 Q20 8 34 20 Q20 32 6 20 Z"
            fill="none"
            stroke={stroke}
            strokeWidth="2.2"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="20" r="4.5" fill="none" stroke={stroke} strokeWidth="2.2" />
          <circle cx="20" cy="20" r="1.6" fill={stroke} />
        </svg>
      );
    case 'card-stack':
      return (
        <svg viewBox="0 0 40 40" className={styles.svg} aria-hidden focusable="false">
          {/* Three offset cards */}
          <rect x="10" y="14" width="14" height="18" rx="1.5" fill="none" stroke={stroke} strokeWidth="1.8" />
          <rect x="13" y="11" width="14" height="18" rx="1.5" fill="none" stroke={stroke} strokeWidth="1.8" />
          <rect x="16" y="8" width="14" height="18" rx="1.5" fill="none" stroke={stroke} strokeWidth="2" />
        </svg>
      );
    default:
      return null;
  }
}
