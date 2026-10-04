// Disney Lorcana rarity vocabulary.
//
// Production tcg_cards.rarity values, verified 2026-09-26 in
// docs/lorcana/data-audit.md §3 (Title-Case strings):
//
//   Common | Uncommon | Rare | Super rare | Legendary | Epic | Iconic
//   | Enchanted | Promo
//
// The chase axis is dominated by:
//   * Enchanted (224 rows) — the alt-art / bordered-illustration slot
//   * Iconic     (10 rows)  — top-shelf D23-style overprints
//   * Epic       (90 rows)
//   * Legendary  (160 rows) — Set 9+ Illumineer's Trove marquee card
//
// Promo lives on its own axis (199 rows across p1/p2/p3/cp/d23/…).

export type LcRarityCode =
  | 'C'
  | 'U'
  | 'R'
  | 'SR'
  | 'L'
  | 'EP'
  | 'IC'
  | 'EN'
  | 'P'
  | 'UNKNOWN';

export interface LcRarity {
  code: LcRarityCode;
  raw: string;
  label: string;
}

const CANONICAL: Record<string, { code: LcRarityCode; label: string }> = {
  c: { code: 'C', label: 'Common' },
  common: { code: 'C', label: 'Common' },
  u: { code: 'U', label: 'Uncommon' },
  uc: { code: 'U', label: 'Uncommon' },
  uncommon: { code: 'U', label: 'Uncommon' },
  r: { code: 'R', label: 'Rare' },
  rare: { code: 'R', label: 'Rare' },
  sr: { code: 'SR', label: 'Super Rare' },
  'super rare': { code: 'SR', label: 'Super Rare' },
  l: { code: 'L', label: 'Legendary' },
  legendary: { code: 'L', label: 'Legendary' },
  ep: { code: 'EP', label: 'Epic' },
  epic: { code: 'EP', label: 'Epic' },
  ic: { code: 'IC', label: 'Iconic' },
  iconic: { code: 'IC', label: 'Iconic' },
  en: { code: 'EN', label: 'Enchanted' },
  enchanted: { code: 'EN', label: 'Enchanted' },
  p: { code: 'P', label: 'Promo' },
  promo: { code: 'P', label: 'Promo' },
};

export function normaliseRarity(raw: string | null | undefined): LcRarity {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { code: 'UNKNOWN', raw: '', label: 'Unknown' };
  const hit = CANONICAL[trimmed.toLowerCase()];
  if (hit) return { code: hit.code, raw: trimmed, label: hit.label };
  return { code: 'UNKNOWN', raw: trimmed, label: trimmed };
}

// Collector ladder — Common → Iconic → Enchanted, with Promo sitting on
// its own axis. Used to order rarity chips and filters consistently
// across the site.
export const RARITY_LADDER: readonly LcRarityCode[] = [
  'C',
  'U',
  'R',
  'SR',
  'L',
  'EP',
  'IC',
  'EN',
  'P',
] as const;

/** Sort helper, cards with higher rarity rank sort first. Unknown last. */
export function rarityRank(code: LcRarityCode): number {
  const idx = RARITY_LADDER.indexOf(code);
  return idx === -1 ? RARITY_LADDER.length : idx;
}
