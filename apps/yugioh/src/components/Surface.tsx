import type { ElementType, HTMLAttributes } from 'react';
import styles from './Surface.module.css';

type SurfaceVariant = 'base' | 'raised' | 'card' | 'market' | 'premium' | 'overlay';

interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  variant?: SurfaceVariant;
  as?: ElementType;
}

const CLASS: Record<SurfaceVariant, string> = {
  base: styles.base ?? '',
  raised: styles.raised ?? '',
  card: styles.card ?? '',
  market: styles.market ?? '',
  premium: styles.premium ?? '',
  overlay: styles.overlay ?? '',
};

export function Surface({
  variant = 'raised',
  as: Tag = 'div',
  className,
  ...rest
}: SurfaceProps) {
  const classes = [styles.surface, CLASS[variant], className ?? '']
    .filter(Boolean)
    .join(' ');
  return <Tag className={classes} data-surface={variant} {...rest} />;
}
