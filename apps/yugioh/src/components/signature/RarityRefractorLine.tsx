import { normaliseRarity } from '../../lib/rarity';
import styles from './RarityRefractorLine.module.css';

interface RarityRefractorLineProps {
  rarity: string | null | undefined;
}

// Signature YGO motif — a thin spectral horizontal line that carries
// rarity semantics. Used as a subtle accent under card names and above
// premium sections.
export function RarityRefractorLine({ rarity }: RarityRefractorLineProps) {
  const family = normaliseRarity(rarity);
  return <span className={styles.line} data-family={family} aria-hidden="true" />;
}
