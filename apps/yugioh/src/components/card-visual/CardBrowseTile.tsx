import Link from 'next/link';
import { CardImageFrame } from '../CardImageFrame';
import { RarityBadge } from '../RarityBadge';
import styles from '../browse/Browse.module.css';

export interface CardBrowseTileProps {
  href: string;
  name: string;
  rarity: string | null | undefined;
  image: string | null | undefined;
  collectorNumber?: string | null;
  // Optional set line for pages where the tile is not already scoped
  // to a single set (rarity/archetype grids). Kept as a plain string
  // so callers can pass e.g. "LOB · 2002".
  setLine?: string | null;
  bestUsdRetail?: number | null;
  bestEurRetail?: number | null;
}

// Shared tile for image-led card grids (set / rarity / archetype
// browse pages). Uses the .setCard* class family in Browse.module.css
// so all three surfaces render an identical visual language.
export function CardBrowseTile(props: CardBrowseTileProps) {
  const {
    href,
    name,
    rarity,
    image,
    collectorNumber,
    setLine,
    bestUsdRetail,
    bestEurRetail,
  } = props;
  return (
    <Link
      href={href}
      className={styles.setCardTile}
      aria-label={`${name} — ${rarity ?? 'card'}${
        collectorNumber ? ` · ${collectorNumber}` : ''
      }`}
    >
      <div className={styles.setCardImageWrap}>
        <CardImageFrame src={image} alt={name} rarity={rarity} gloss={false} />
        {collectorNumber && (
          <span className={styles.setCardNumber}>{collectorNumber}</span>
        )}
      </div>
      <div className={styles.setCardBody}>
        <p className={styles.setCardName} title={name}>
          {name}
        </p>
        <div className={styles.setCardMetaRow}>
          <RarityBadge rarity={rarity} />
          {setLine && <span className={styles.setCardSetLine}>{setLine}</span>}
        </div>
        <div className={styles.setCardPriceRow}>
          {bestUsdRetail != null ? (
            <span className={styles.setCardPrice}>
              $
              {bestUsdRetail.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          ) : (
            <span className={styles.setCardPriceDim}>—</span>
          )}
          {bestEurRetail != null && (
            <span className={styles.setCardPriceAlt}>
              €
              {bestEurRetail.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
