import styles from './CardMiniThumb.module.css';

interface CardMiniThumbProps {
  src?: string | null;
  alt: string;
  size?: 'sm' | 'md';
}

// Compact card artwork thumbnail used inside stat panels and market
// ranking rows. Uses the intrinsic 59:86 card aspect ratio so slots
// reserve space and never trigger CLS while the image loads.
//
// Small (sm) is 42px wide (row-appropriate); medium (md) is 60px for
// featured "highest value" tiles. The image itself is fetched from
// the same card.images.small URL the set/rarity grids already use —
// no additional network call beyond the browser's own image cache.
export function CardMiniThumb({ src, alt, size = 'sm' }: CardMiniThumbProps) {
  const cls = size === 'md' ? styles.md : styles.sm;
  return (
    <span className={`${styles.wrap} ${cls}`} aria-hidden={src ? undefined : true}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={styles.img}
        />
      ) : (
        <span className={styles.placeholder} />
      )}
    </span>
  );
}
