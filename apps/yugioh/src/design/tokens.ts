// Yu-Gi-Oh! design tokens. Semantic first; raw values live only in this
// file and in tokens.css (kept in sync manually — no runtime CSS-in-JS).
//
// This module is Yu-Gi-Oh!-only. Never move it into packages/*.

export const RARITY_FAMILIES = [
  'common',
  'rare',
  'super',
  'ultra',
  'ultimate',
  'secret',
  'prismatic-secret',
  'ghost',
  'collectors',
  'prismatic-collectors',
  'starlight',
  'qcsr',
  'gold',
  'platinum',
  'parallel',
  'short-print',
  'other',
] as const;

export type RarityFamily = (typeof RARITY_FAMILIES)[number];

export const ATTRIBUTES = [
  'LIGHT',
  'DARK',
  'FIRE',
  'WATER',
  'WIND',
  'EARTH',
  'DIVINE',
] as const;

export type Attribute = (typeof ATTRIBUTES)[number];

export const CARD_CLASSES = [
  'normal',
  'effect',
  'ritual',
  'fusion',
  'synchro',
  'xyz',
  'pendulum',
  'link',
  'spell',
  'trap',
  'unknown',
] as const;

export type CardClass = (typeof CARD_CLASSES)[number];

export const SPELL_SUBTYPES = [
  'normal',
  'quick-play',
  'continuous',
  'field',
  'equip',
  'ritual',
  'unknown',
] as const;

export const TRAP_SUBTYPES = [
  'normal',
  'continuous',
  'counter',
  'unknown',
] as const;

export type SpellSubtype = (typeof SPELL_SUBTYPES)[number];
export type TrapSubtype = (typeof TRAP_SUBTYPES)[number];

export const FNL_STATES = [
  'forbidden',
  'limited',
  'semi-limited',
  'unlimited',
  'unknown',
] as const;

export type FnlState = (typeof FNL_STATES)[number];

export const GRADERS = ['psa', 'bgs', 'cgc', 'sgc', 'any'] as const;
export type Grader = (typeof GRADERS)[number];

// Grades presented in the UI. 'ungraded' belongs to the raw side and must
// never surface through graded components.
export const DISPLAYABLE_GRADES = ['10', '9.5', '9', '8', '7'] as const;
export type DisplayableGrade = (typeof DISPLAYABLE_GRADES)[number];

// Semantic size steps. Used sparingly by primitives; layout code is free
// to compose from these but should not invent new values.
export const size = {
  '2xs': '2px',
  xs: '4px',
  sm: '6px',
  md: '8px',
  base: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
} as const;

export const radius = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '10px',
  pill: '999px',
} as const;

// Semantic durations — restrained. Reduced-motion callers should treat
// these as 0.
export const motion = {
  fast: '120ms',
  base: '200ms',
  slow: '360ms',
  ease: 'cubic-bezier(0.2, 0.6, 0.2, 1)',
  glint: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

// Human labels for rarity families. Used in the design lab; components
// receive raw rarity strings and are responsible for their own labels.
export const RARITY_FAMILY_LABELS: Record<RarityFamily, string> = {
  common: 'Common',
  rare: 'Rare',
  super: 'Super Rare',
  ultra: 'Ultra Rare',
  ultimate: 'Ultimate Rare',
  secret: 'Secret family',
  'prismatic-secret': 'Prismatic Secret',
  ghost: 'Ghost Rare',
  collectors: "Collector's Rare",
  'prismatic-collectors': "Prismatic Collector's",
  starlight: 'Starlight Rare',
  qcsr: 'Quarter Century Secret',
  gold: 'Gold family',
  platinum: 'Platinum family',
  parallel: 'Parallel family',
  'short-print': 'Short Print',
  other: 'Other',
};

export const FNL_STATE_LABELS: Record<FnlState, string> = {
  forbidden: 'Forbidden',
  limited: 'Limited',
  'semi-limited': 'Semi-Limited',
  unlimited: 'Unlimited',
  unknown: 'Unknown',
};

export const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  LIGHT: 'Light',
  DARK: 'Dark',
  FIRE: 'Fire',
  WATER: 'Water',
  WIND: 'Wind',
  EARTH: 'Earth',
  DIVINE: 'Divine',
};
