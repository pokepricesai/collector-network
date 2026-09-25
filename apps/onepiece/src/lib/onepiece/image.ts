// Card-image URL selection. The shared tcg_cards.images JSON is stored
// with { large, normal, small } keys but some rows only have a subset
// or use different conventions. This helper picks the largest
// available image and returns null when none are usable.

import type { TcgCardImages } from '@collector-network/database';

export function pickCardImage(
  images: TcgCardImages | null | undefined,
  preferred: keyof TcgCardImages = 'large',
): string | null {
  if (!images) return null;
  const order: Array<keyof TcgCardImages> =
    preferred === 'large'
      ? ['large', 'normal', 'small']
      : preferred === 'normal'
        ? ['normal', 'large', 'small']
        : ['small', 'normal', 'large'];
  for (const k of order) {
    const v = images[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
