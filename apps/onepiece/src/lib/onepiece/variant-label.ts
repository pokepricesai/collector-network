// User-facing labelling for a collectible variant.
//
// Internal identifiers such as OP07-038_p2 or OP01-120_r2 must never
// surface as if they were the official printed collector number. The
// suffix is our slug convention, not what Bandai prints on the card.
//
// Instead we compose a friendly line from three DB-proven parts:
//   * base collector number (as printed): OP07-038
//   * treatment label from inferTreatment: Parallel / Reprint / Leader
//     / Secret Rare / Treasure Rare / Special Card / Promo / Standard
//   * variant index where the treatment supports one: #1, #2 …
//
// Routes and slugs KEEP the suffix — this file only affects display.
// No new treatment terminology is invented; every label comes from
// treatment.ts / inferTreatment.

import { inferTreatment, treatmentInfo, type OpTreatment } from './treatment';

export interface VariantLabel {
  /** Base printed collector number (no _p/_r suffix). */
  base: string;
  /** Full DB collector including suffix. Kept for aria-label + JSON-LD only. */
  full: string;
  /** Human-facing treatment label from the DB. `null` when the row is
   *  a plain standard printing that carries no chase / parallel / reprint
   *  signal — callers can decide whether to show "Standard" or nothing. */
  treatmentLabel: string | null;
  /** Treatment code — useful for callers that need to differentiate
   *  parallel vs standard behaviourally. */
  treatmentCode: OpTreatment;
  /** Variant index (from `_p#` / `_r#` suffix). `null` when absent. */
  variantIndex: number | null;
  /** Friendly display line "OP07-038 · Parallel #2". Uses middle dot. */
  displayLine: string;
  /** Same content without the middle-dot separator, safe for plain-text
   *  contexts like FAQ headings, ebay queries, alt text. */
  displayLinePlain: string;
}

/** Build a display label from a raw collector number + card rarity.
 *  When `collectorNumber` is missing or unrecognised, falls back to
 *  the empty string for `base` and a `Standard` treatment. */
export function formatVariantLabel(
  collectorNumber: string | null | undefined,
  rarity: string | null | undefined,
): VariantLabel {
  const full = (collectorNumber ?? '').trim();
  const base = full.replace(/_(?:p|r)\d+$/i, '');
  const trace = inferTreatment({ collectorNumber: full, rarity });
  const info = treatmentInfo(trace.treatment);
  // `Standard` gets a null label so callers can suppress it (a standard
  // print doesn't need a redundant "Standard" tag next to its collector
  // number). Every other treatment surfaces its DB label.
  const treatmentLabel = trace.treatment === 'standard' ? null : info.label;
  const withIndex =
    treatmentLabel != null && trace.variantIndex != null
      ? `${treatmentLabel} #${trace.variantIndex}`
      : treatmentLabel;
  const displayLine = withIndex ? `${base} · ${withIndex}` : base;
  const displayLinePlain = withIndex ? `${base} ${withIndex}` : base;
  return {
    base,
    full,
    treatmentLabel,
    treatmentCode: trace.treatment,
    variantIndex: trace.variantIndex,
    displayLine,
    displayLinePlain,
  };
}
