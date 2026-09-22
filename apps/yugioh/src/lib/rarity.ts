import type { RarityFamily } from '../design/tokens';

// Normalises the ~23+ raw rarity strings observed in production
// (see docs/yugioh/data-audit.md §6) into a small set of visual
// families. Unknown values fall through to "other" so the UI stays
// stable when Konami inevitably introduces a new rarity we haven't
// mapped yet.
//
// Case-insensitive; trims whitespace; normalises curly-apostrophe
// variants of "Collector's".

const CANONICAL_MAP: Record<string, RarityFamily> = {
  common: 'common',
  'short print': 'short-print',

  rare: 'rare',
  'super rare': 'super',
  'ultra rare': 'ultra',
  'ultimate rare': 'ultimate',

  'secret rare': 'secret',
  'ultra secret rare': 'secret',
  'extra secret rare': 'secret',
  // Production data-quality anomaly: 'Extra Secret' (no 'Rare') — treat
  // as Secret. Tracked in docs/yugioh/data-ingestion-plan.md § R2.
  'extra secret': 'secret',

  'prismatic secret rare': 'prismatic-secret',

  'ghost rare': 'ghost',
  'ghost/gold rare': 'ghost',

  "collector's rare": 'collectors',
  "prismatic collector's rare": 'prismatic-collectors',

  'starlight rare': 'starlight',
  'quarter century secret rare': 'qcsr',
  'quarter century ultra rare': 'qcsr',

  'gold rare': 'gold',
  'premium gold rare': 'gold',
  'gold secret rare': 'gold',

  'platinum rare': 'platinum',
  'platinum secret rare': 'platinum',

  // Parallel family — includes multiple treatments Konami collapses
  // under "some form of parallel/foil overlay".
  'parallel rare': 'parallel',
  'mosaic rare': 'parallel',
  'shatterfoil rare': 'parallel',
  'starfoil rare': 'parallel',
  "pharaoh's rare": 'parallel',
  'duel terminal normal parallel rare': 'parallel',
  'duel terminal rare parallel rare': 'parallel',
  'duel terminal super parallel rare': 'parallel',
  'duel terminal ultra parallel rare': 'parallel',
  'duel terminal secret parallel rare': 'parallel',
};

export function normaliseRarity(raw: string | null | undefined): RarityFamily {
  if (!raw) return 'other';
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
  return CANONICAL_MAP[key] ?? 'other';
}

// Returns true when the family carries a spectral / prismatic accent —
// signals to components that should apply the refractor treatment.
export function familyHasSpectral(family: RarityFamily): boolean {
  return (
    family === 'secret' ||
    family === 'prismatic-secret' ||
    family === 'starlight' ||
    family === 'qcsr' ||
    family === 'prismatic-collectors'
  );
}
