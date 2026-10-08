import 'server-only';

// Centralised intelligence priority scoring.
//
// Formula (clamped 0..100):
//   priority = impact * 0.35
//            + confidence * 0.25
//            + urgency * 0.25
//            + ease * 0.15
// where ease = 100 - effort.
//
// Keeping this in one place so the formula can be tweaked without
// touching every rule module.

const WEIGHT_IMPACT     = 0.35;
const WEIGHT_CONFIDENCE = 0.25;
const WEIGHT_URGENCY    = 0.25;
const WEIGHT_EASE       = 0.15;

const WEIGHTS_SUM = WEIGHT_IMPACT + WEIGHT_CONFIDENCE + WEIGHT_URGENCY + WEIGHT_EASE;
if (Math.abs(WEIGHTS_SUM - 1) > 1e-9) {
  throw new Error(`[intelligence/scoring] weights must sum to 1 (got ${WEIGHTS_SUM})`);
}

export interface ScoreComponents {
  impact: number;
  confidence: number;
  urgency: number;
  effort: number;
}

export function clamp(v: number, min = 0, max = 100): number {
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return Math.round(v);
}

export function computePriority(c: ScoreComponents): number {
  const impact     = clamp(c.impact);
  const confidence = clamp(c.confidence);
  const urgency    = clamp(c.urgency);
  const effort     = clamp(c.effort);
  const ease       = 100 - effort;
  const priority =
      impact     * WEIGHT_IMPACT
    + confidence * WEIGHT_CONFIDENCE
    + urgency    * WEIGHT_URGENCY
    + ease       * WEIGHT_EASE;
  return clamp(priority);
}

export const PRIORITY_FORMULA_LABEL =
  `impact×${WEIGHT_IMPACT} + confidence×${WEIGHT_CONFIDENCE} + urgency×${WEIGHT_URGENCY} + ease×${WEIGHT_EASE}`;

export const PRIORITY_WEIGHTS = {
  impact: WEIGHT_IMPACT,
  confidence: WEIGHT_CONFIDENCE,
  urgency: WEIGHT_URGENCY,
  ease: WEIGHT_EASE,
};

// Lightweight categorisation for the UI's "critical / high / normal
// / low" chip. Pure read-only.
export type PriorityBand = 'critical' | 'high' | 'normal' | 'low';
export function priorityBand(priority: number): PriorityBand {
  if (priority >= 85) return 'critical';
  if (priority >= 70) return 'high';
  if (priority >= 45) return 'normal';
  return 'low';
}
