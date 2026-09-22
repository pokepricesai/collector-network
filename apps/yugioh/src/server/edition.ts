// YGO-specific edition interpretation for `tcg_printings.edition`.
//
// Audited values in production (Sept 2026): "1st_edition", "limited",
// NULL. Unlimited is not explicitly stored — NULL is ambiguous between
// "post-1st-Ed print run" and "no edition axis for this product type".
// Slice 2 assumed Unlimited would be a first-class stored value; this
// layer normalises the reality without pretending we have data we don't.

export type EditionMarker =
  | '1st_edition'
  | 'limited'
  | 'unlimited_or_unknown';

export function normaliseEdition(raw: string | null | undefined): EditionMarker {
  if (raw === '1st_edition') return '1st_edition';
  if (raw === 'limited') return 'limited';
  return 'unlimited_or_unknown';
}

export function editionDisplayLabel(marker: EditionMarker): string {
  switch (marker) {
    case '1st_edition':
      return '1st Edition';
    case 'limited':
      return 'Limited Edition';
    case 'unlimited_or_unknown':
      return 'Unlimited / unmarked';
  }
}
