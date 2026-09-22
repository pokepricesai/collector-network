import { normaliseEdition, type EditionMarker } from '../server/edition';
import styles from './EditionBadge.module.css';

interface EditionBadgeProps {
  edition: string | null | undefined;
}

// Explicit label map. Notably, `unlimited_or_unknown` is NOT labelled
// "Unlimited" — production data cannot honestly assert Unlimited from
// a NULL edition field (see docs/yugioh/data-audit.md §5). Users see
// "Unlimited / Unspecified" so they know it may or may not be Unlimited.
const LABEL: Record<EditionMarker, string> = {
  '1st_edition': '1st Edition',
  limited: 'Limited Edition',
  unlimited_or_unknown: 'Unlimited / Unspecified',
};

const CLASS: Record<EditionMarker, string> = {
  '1st_edition': styles.first ?? '',
  limited: styles.limited ?? '',
  unlimited_or_unknown: styles.unlimited ?? '',
};

const ARIA: Record<EditionMarker, string> = {
  '1st_edition': 'Edition: 1st Edition',
  limited: 'Edition: Limited Edition',
  unlimited_or_unknown: 'Edition: Unlimited or unspecified',
};

export function EditionBadge({ edition }: EditionBadgeProps) {
  const marker = normaliseEdition(edition);
  const classes = [styles.badge, CLASS[marker]].filter(Boolean).join(' ');
  return (
    <span
      className={classes}
      data-edition={marker}
      aria-label={ARIA[marker]}
    >
      <span className={styles.icon} aria-hidden="true" />
      <span>{LABEL[marker]}</span>
    </span>
  );
}
