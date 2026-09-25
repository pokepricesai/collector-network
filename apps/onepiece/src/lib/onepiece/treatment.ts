// Card treatments are the most collector-relevant distinction in the
// One Piece card game. The same logical card can exist as several
// visually and financially distinct printings inside the same set —
// standard, parallel, alternate art, manga rare, special rare. Each is
// a separate priced entity even when the gameplay identity is
// identical.
//
// We derive the treatment from a combination of tcg_cards rarity and
// tcg_printings.edition / finish. Producers vary the exact wording, so
// this file collects the mapping in one place.

export type OpTreatment =
  | 'standard'
  | 'parallel'
  | 'alt-art'
  | 'manga-rare'
  | 'special-rare'
  | 'promo'
  | 'sec';

export interface OpTreatmentInfo {
  code: OpTreatment;
  label: string;
  /** Short badge label (uppercase, ≤3 chars where possible). */
  short: string;
  /** Marketing description used in tooltips and treatment header rows. */
  description: string;
}

export const OP_TREATMENTS: Record<OpTreatment, OpTreatmentInfo> = {
  standard: {
    code: 'standard',
    label: 'Standard',
    short: 'STD',
    description: 'Base printing at the card’s original rarity.',
  },
  parallel: {
    code: 'parallel',
    label: 'Parallel',
    short: 'PARA',
    description: 'Alternate frame / holo-treatment of the base printing.',
  },
  'alt-art': {
    code: 'alt-art',
    label: 'Alternate Art',
    short: 'AA',
    description: 'Full illustration replaced — a distinct chase printing.',
  },
  'manga-rare': {
    code: 'manga-rare',
    label: 'Manga Rare',
    short: 'MR',
    description: 'Panel-style illustration drawn from the manga.',
  },
  'special-rare': {
    code: 'special-rare',
    label: 'Special Rare',
    short: 'SP',
    description: 'Limited festival / event chase treatment.',
  },
  promo: {
    code: 'promo',
    label: 'Promo',
    short: 'PROMO',
    description: 'Promotional printing — event, tournament or launch pack.',
  },
  sec: {
    code: 'sec',
    label: 'Secret Rare',
    short: 'SEC',
    description: 'Highest-rarity secret printing of the card.',
  },
};

/** Derive a treatment from what we know about a printing.
 *
 *  Priority:
 *    1. `edition` string on tcg_printings if it names a known treatment
 *    2. Rarity SEC / SR + certain finish combinations
 *    3. Fallback to 'standard'
 *
 *  The heuristic is deliberately forgiving — new set-specific treatment
 *  strings arrive frequently, so this is a first pass rather than a
 *  strict enumeration. */
export function inferTreatment({
  edition,
  finish,
  rarity,
}: {
  edition: string | null | undefined;
  finish: string | null | undefined;
  rarity: string | null | undefined;
}): OpTreatment {
  const e = normalise(edition);
  const f = normalise(finish);
  const r = normalise(rarity);

  if (e.includes('manga')) return 'manga-rare';
  if (e.includes('alt') || e.includes('alternate')) return 'alt-art';
  if (e.includes('parallel')) return 'parallel';
  if (e.includes('special')) return 'special-rare';
  if (e.includes('promo')) return 'promo';
  if (e === 'sec' || r === 'sec' || r === 'secret' || r === 'secret rare') return 'sec';

  if (f.includes('alt') || f.includes('alternate')) return 'alt-art';
  if (f.includes('parallel')) return 'parallel';
  if (f.includes('manga')) return 'manga-rare';

  return 'standard';
}

export function treatmentInfo(code: OpTreatment): OpTreatmentInfo {
  return OP_TREATMENTS[code];
}

export function treatmentBadgeClass(code: OpTreatment): string {
  switch (code) {
    case 'standard':      return 'treatment-badge treatment-badge--standard';
    case 'parallel':      return 'treatment-badge treatment-badge--parallel';
    case 'alt-art':       return 'treatment-badge treatment-badge--alt-art';
    case 'manga-rare':    return 'treatment-badge treatment-badge--manga-rare';
    case 'special-rare':  return 'treatment-badge treatment-badge--special-rare';
    case 'promo':         return 'treatment-badge treatment-badge--promo';
    case 'sec':           return 'treatment-badge treatment-badge--sec';
  }
}

function normalise(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}
