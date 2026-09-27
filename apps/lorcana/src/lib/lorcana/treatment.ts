// Card treatments — the collector axis Lorcana surfaces on printings.
//
// Production reality (verified 2026-09-26 by docs/lorcana/data-audit.md
// §4 and §5):
//   * `tcg_printings.finish` is `foil` or `nonfoil` — no other values.
//   * `tcg_printings.edition` is 100% NULL — nothing lives there.
//   * `tcggraph_printing_key` echoes finish (`foil` / `normal`).
//   * The chase axis is on `tcg_cards.rarity`, not printings:
//       Enchanted (224) — bordered alt-art overprint slot
//       Iconic    (10)  — top-shelf overprints (D23-tier)
//       Epic      (90)
//       Legendary (160) — Set 9+ Illumineer's Trove marquee
//       Promo     (199) — event / launch / D23 collections
//
// A logical Lorcana card is therefore identified by (name, set,
// collector_number, rarity) — Enchanted / Promo variants have their own
// tcg_cards rows, not their own printings. Each such card typically has
// two printings (foil + nonfoil), though Promos and some Iconics may
// exist in only one finish.
//
// So the "treatment" the UI cares about is a compound of:
//   1. finish        (foil vs nonfoil)  — printing-level
//   2. rarity chase  (Enchanted, Iconic, Epic, Legendary, Promo)
//                    — card-level, hoisted onto the printing view.
//
// This module returns one small enum + label bundle per (finish, rarity).

import type { LcRarityCode } from './rarity';

export type LcFinish = 'nonfoil' | 'foil';

export interface LcTreatmentInfo {
  /** Machine code — stable, url-safe. */
  code: string;
  /** Human label shown in headings and chips. */
  label: string;
  /** Short badge label (≤5 chars ideally). */
  short: string;
  /** Marketing/description used in tooltips. */
  description: string;
  finish: LcFinish;
  /** True when the treatment is a collector-chase overprint slot. */
  isChase: boolean;
}

const FINISH_LABEL: Record<LcFinish, string> = {
  nonfoil: 'Nonfoil',
  foil: 'Foil',
};

const FINISH_SHORT: Record<LcFinish, string> = {
  nonfoil: 'NF',
  foil: 'FOIL',
};

const FINISH_DESCRIPTION: Record<LcFinish, string> = {
  nonfoil: 'Standard non-foil printing.',
  foil: 'Cold-foil printing with the shimmering Lorcana treatment.',
};

/** Overprint slots (rarity-driven, but also imply a distinct printing). */
const CHASE_LABEL: Partial<Record<LcRarityCode, { label: string; short: string; description: string }>> = {
  EN: {
    label: 'Enchanted',
    short: 'ENCH',
    description: 'Bordered, full-illustration alt-art overprint. The signature Lorcana chase.',
  },
  IC: {
    label: 'Iconic',
    short: 'ICON',
    description: 'Top-tier overprint reserved for the rarest Lorcana cards.',
  },
  EP: {
    label: 'Epic',
    short: 'EPIC',
    description: 'Epic-rarity chase treatment — extended-art or textured foil.',
  },
  L: {
    label: 'Legendary',
    short: 'LEG',
    description: 'Legendary — the deck-defining tier below Iconic / Enchanted.',
  },
  P: {
    label: 'Promo',
    short: 'PROMO',
    description: 'Promotional printing — event, launch, D23 or partner exclusive.',
  },
};

export function normaliseFinish(v: string | null | undefined): LcFinish {
  const raw = (v ?? '').trim().toLowerCase();
  if (raw === 'foil') return 'foil';
  return 'nonfoil';
}

/** Derive a treatment view from (finish, rarity).
 *
 *  Rarity chase overrides the plain foil / nonfoil label — an Enchanted
 *  foil is presented as "Enchanted · Foil" rather than just "Foil".
 */
export function inferTreatment(input: {
  finish: string | null | undefined;
  rarity: LcRarityCode | null | undefined;
}): LcTreatmentInfo {
  const finish = normaliseFinish(input.finish);
  const chase = input.rarity ? CHASE_LABEL[input.rarity] : undefined;

  if (chase) {
    return {
      code: `${input.rarity!.toLowerCase()}-${finish}`,
      label: `${chase.label} · ${FINISH_LABEL[finish]}`,
      short: chase.short,
      description: chase.description,
      finish,
      isChase: true,
    };
  }

  return {
    code: finish,
    label: FINISH_LABEL[finish],
    short: FINISH_SHORT[finish],
    description: FINISH_DESCRIPTION[finish],
    finish,
    isChase: false,
  };
}

export function treatmentBadgeClass(t: LcTreatmentInfo): string {
  return `treatment-badge treatment-badge--${t.code}`;
}

/** Preferred display order — chase treatments come first so the
 *  headline collector interest sits at the top of the card page. */
export const TREATMENT_DISPLAY_ORDER: readonly string[] = [
  'en-foil',
  'en-nonfoil',
  'ic-foil',
  'ic-nonfoil',
  'ep-foil',
  'ep-nonfoil',
  'l-foil',
  'l-nonfoil',
  'p-foil',
  'p-nonfoil',
  'foil',
  'nonfoil',
] as const;
