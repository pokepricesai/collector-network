import type { CSSProperties } from 'react';
import { normaliseRarity } from '../lib/rarity';
import styles from './CardImageFrame.module.css';

interface CardImageFrameProps {
  src?: string | null;
  alt: string;
  rarity?: string | null | undefined;
  maxWidth?: number;
  gloss?: boolean;
}

// Wrap for card catalogue images. Rarity is passed through as a data
// attribute so the CSS can apply high-rarity hover treatments without
// runtime JS. Placeholder is rendered when `src` is missing — no broken
// image icons.
export function CardImageFrame({
  src,
  alt,
  rarity,
  maxWidth,
  gloss = true,
}: CardImageFrameProps) {
  const family = normaliseRarity(rarity);
  const style = maxWidth ? ({ '--ygo-frame-max': `${maxWidth}px` } as CSSProperties) : undefined;
  const classes = [styles.frame, gloss ? styles.gloss : ''].filter(Boolean).join(' ');
  return (
    <div className={classes} style={style} data-rarity={family}>
      {src ? (
        // Using a plain <img> here (not next/image) because catalogue
        // images may be remote and the frame is used in many contexts
        // including the dev design lab. Next.js image optimisation can
        // wrap this later without changing the API.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={styles.img}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className={styles.placeholder} aria-label={alt}>
          card image
        </div>
      )}
    </div>
  );
}
