import { normaliseEdition, type EditionMarker } from '../server/edition';
import styles from './PrintingFingerprint.module.css';

interface PrintingFingerprintProps {
  collectorNumber: string | null | undefined;
  rarity: string | null | undefined;
  edition: string | null | undefined;
  language: string | null | undefined;
}

const EDITION_SHORT: Record<EditionMarker, string> = {
  '1st_edition': '1st Ed',
  limited: 'Limited',
  unlimited_or_unknown: 'Unlimited/?',
};

const EDITION_ARIA: Record<EditionMarker, string> = {
  '1st_edition': '1st Edition',
  limited: 'Limited Edition',
  unlimited_or_unknown: 'Unlimited or unspecified edition',
};

export function PrintingFingerprint({
  collectorNumber,
  rarity,
  edition,
  language,
}: PrintingFingerprintProps) {
  const editionMarker = normaliseEdition(edition);
  const rarityLabel = rarity?.trim() || '—';
  const langLabel = (language || '?').toUpperCase();
  const codeLabel = collectorNumber?.trim() || '—';
  const aria = `Printing ${codeLabel}, ${rarityLabel}, ${EDITION_ARIA[editionMarker]}, language ${langLabel}`;
  return (
    <div className={styles.pill} role="group" aria-label={aria}>
      <span className={`${styles.cell} ${styles.code}`}>{codeLabel}</span>
      <span className={`${styles.cell} ${styles.rarity}`}>{rarityLabel}</span>
      <span
        className={`${styles.cell} ${styles.edition}`}
        data-edition={editionMarker}
      >
        {EDITION_SHORT[editionMarker]}
      </span>
      <span className={`${styles.cell} ${styles.lang}`}>{langLabel}</span>
    </div>
  );
}
