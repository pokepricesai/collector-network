// Card treatments are the most collector-relevant distinction in the
// One Piece card game. The same logical card can exist as several
// visually and financially distinct printings even inside the same set —
// standard, parallel, secret rare, special card, treasure rare, promo,
// reprint. Each is a separate priced entity even when the gameplay
// identity is identical.
//
// Production signal — verified 2026-09-26 by docs/onepiece/data-audit.md:
//   * `tcg_printings.edition` is 100% NULL for OP; do not rely on it.
//   * `finish` = `nonfoil` or `foil` — orthogonal to treatment; a single
//     treatment usually exists in both finishes.
//   * The treatment axis lives in `tcg_cards.collector_number` suffixes:
//       `OP##-###`      → standard base printing
//       `OP##-###_p1`   → parallel #1
//       `OP##-###_p2`   → parallel #2
//       `OP##-###_p3`   → parallel #3 (and higher)
//       `OP##-###_r1`   → reprint (subsequent print run)
//   * Rarity strings from `tcg_cards.rarity` distinguish:
//       `SEC`      → Secret Rare
//       `SP CARD`  → Special Card (literal space in the value)
//       `TR`       → Treasure Rare
//       `P`        → Promo
//       `L`        → Leader (rarity, treated as its own gameplay category)
//       `C`/`UC`/`R`/`SR` → base rarities (Common / Uncommon / Rare / Super Rare)
//
// Deliberately NOT inferred:
//   * `manga-rare` — TCGGraph does not tag manga rares distinctly for OP;
//     they collapse into the `_p*` slot with no reliable production
//     signal. Never show "Manga Rare" unless a downstream ingest field
//     names it explicitly.
//   * `alt-art` as a standalone category — TCGGraph doesn't split
//     alt-art from parallel for OP. All `_p*` variants are treated as
//     Parallel with the numeric suffix preserved as the fingerprint.

export type OpTreatment =
  | 'standard'
  | 'parallel'
  | 'reprint'
  | 'special-card'
  | 'secret-rare'
  | 'treasure-rare'
  | 'promo'
  | 'leader';

export interface OpTreatmentInfo {
  code: OpTreatment;
  label: string;
  /** Short badge label (uppercase, ≤5 chars where possible). */
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
    description: 'Alternate-frame / holo-treatment variant of a card. Distinguished by a `_p#` suffix on the collector number.',
  },
  reprint: {
    code: 'reprint',
    label: 'Reprint',
    short: 'RE',
    description: 'A subsequent print run of the same card. Distinguished by a `_r#` suffix on the collector number.',
  },
  'special-card': {
    code: 'special-card',
    label: 'Special Card',
    short: 'SP',
    description: 'A limited chase treatment released as a Special Card (SP CARD) rarity.',
  },
  'secret-rare': {
    code: 'secret-rare',
    label: 'Secret Rare',
    short: 'SEC',
    description: 'Highest-rarity secret printing of the card.',
  },
  'treasure-rare': {
    code: 'treasure-rare',
    label: 'Treasure Rare',
    short: 'TR',
    description: 'Extremely limited Treasure Rare (TR) chase printing.',
  },
  promo: {
    code: 'promo',
    label: 'Promo',
    short: 'PROMO',
    description: 'Promotional printing — event, tournament or launch pack.',
  },
  leader: {
    code: 'leader',
    label: 'Leader',
    short: 'L',
    description: 'A Leader card — anchors deck construction.',
  },
};

/** Numeric suffix pulled off `_p#` or `_r#` on the collector number.
 *  Preserved on the treatment for display in the printing fingerprint. */
export interface TreatmentTrace {
  treatment: OpTreatment;
  /** For parallel / reprint: the numeric suffix. `null` otherwise. */
  variantIndex: number | null;
  /** Raw suffix string (e.g. `_p2`, `_r1`). `null` for base printings. */
  rawSuffix: string | null;
}

const PARALLEL_RE = /_p(\d+)$/i;
const REPRINT_RE  = /_r(\d+)$/i;

/** Derive a treatment from the production shape of a card + printing.
 *
 *  Priority reflects how OP collectors actually categorise cards:
 *
 *    1. `_r#` suffix → REPRINT — a print-run distinction that overrides
 *       everything else. A reprint is called a reprint even if the
 *       reprinted card is a SEC / SP CARD / L / etc.
 *    2. Rarity chase tier — SP CARD / SEC / TR / P / L are all more
 *       specific than a generic Parallel label. A `_p#` suffix on a
 *       chase-tier card contributes its variant index to the fingerprint
 *       but does NOT downgrade the treatment label.
 *    3. `_p#` suffix on non-chase rarity → PARALLEL with variant index.
 *    4. Fall through → STANDARD.
 *
 *  `edition` and `finish` are accepted for backwards compatibility but
 *  no longer contribute to the decision (edition is always NULL for OP
 *  and finish is orthogonal to treatment — a single treatment usually
 *  exists in both nonfoil + foil).
 */
export function inferTreatment(input: {
  collectorNumber: string | null | undefined;
  rarity: string | null | undefined;
  /** @deprecated OP never populates edition; kept so existing callers compile. */
  edition?: string | null | undefined;
  /** @deprecated finish is a separate axis, not a treatment signal. */
  finish?: string | null | undefined;
}): TreatmentTrace {
  const cn = (input.collectorNumber ?? '').trim();
  const rarity = (input.rarity ?? '').trim().toUpperCase();

  const reprintMatch = cn.match(REPRINT_RE);
  if (reprintMatch) {
    return {
      treatment: 'reprint',
      variantIndex: Number(reprintMatch[1]),
      rawSuffix: reprintMatch[0]!,
    };
  }

  const parallelMatch = cn.match(PARALLEL_RE);
  const variantIndex = parallelMatch ? Number(parallelMatch[1]) : null;
  const rawSuffix = parallelMatch?.[0] ?? null;

  // Rarity-driven chase treatments outrank the generic parallel label.
  // We still surface the variant index so the printing fingerprint reads
  // e.g. "Special Card #3" rather than just "Special Card".
  if (rarity === 'SP CARD') return { treatment: 'special-card',  variantIndex, rawSuffix };
  if (rarity === 'SEC')     return { treatment: 'secret-rare',   variantIndex, rawSuffix };
  if (rarity === 'TR')      return { treatment: 'treasure-rare', variantIndex, rawSuffix };
  if (rarity === 'P')       return { treatment: 'promo',         variantIndex, rawSuffix };
  if (rarity === 'L') {
    // A parallel of a Leader → keep the "Parallel" label. The base
    // Leader stays "Leader"; its parallels (`_p1`, `_p2`) are collector
    // variants, not new gameplay-role cards. This preserves the
    // production distinction between "Monkey.D.Luffy L base" and
    // "Monkey.D.Luffy L parallel #1".
    if (parallelMatch) {
      return { treatment: 'parallel', variantIndex, rawSuffix };
    }
    return { treatment: 'leader', variantIndex: null, rawSuffix: null };
  }

  if (parallelMatch) {
    return { treatment: 'parallel', variantIndex, rawSuffix };
  }

  return { treatment: 'standard', variantIndex: null, rawSuffix: null };
}

export function treatmentInfo(code: OpTreatment): OpTreatmentInfo {
  return OP_TREATMENTS[code];
}

export function treatmentBadgeClass(code: OpTreatment): string {
  return `treatment-badge treatment-badge--${code}`;
}

/** Preferred display order — chase treatments come first so the
 *  headline collector interest sits at the top of the card page. */
export const TREATMENT_DISPLAY_ORDER: readonly OpTreatment[] = [
  'treasure-rare',
  'secret-rare',
  'special-card',
  'parallel',
  'leader',
  'promo',
  'standard',
  'reprint',
] as const;
