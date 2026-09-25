// One Piece card rarity vocabulary. Different from MTG or YGO — chase
// treatments (SEC, alt-art, manga rare, special rare) are the biggest
// collector distinctions in this game.
//
// The shared tcg_cards table stores rarity as a free-text string. We
// map the observed values onto a small canonical set the UI can style
// consistently, but the raw string is preserved for display when we
// don't recognise it.

export type OpRarityCode =
  | 'C'
  | 'UC'
  | 'R'
  | 'SR'
  | 'SEC'
  | 'L'
  | 'P'
  | 'SP'
  | 'TR'
  | 'UNKNOWN';

export interface OpRarity {
  code: OpRarityCode;
  raw: string;
  label: string;
}

const CANONICAL: Record<string, { code: OpRarityCode; label: string }> = {
  c: { code: 'C', label: 'Common' },
  common: { code: 'C', label: 'Common' },
  uc: { code: 'UC', label: 'Uncommon' },
  uncommon: { code: 'UC', label: 'Uncommon' },
  r: { code: 'R', label: 'Rare' },
  rare: { code: 'R', label: 'Rare' },
  sr: { code: 'SR', label: 'Super Rare' },
  'super rare': { code: 'SR', label: 'Super Rare' },
  sec: { code: 'SEC', label: 'Secret Rare' },
  secret: { code: 'SEC', label: 'Secret Rare' },
  'secret rare': { code: 'SEC', label: 'Secret Rare' },
  l: { code: 'L', label: 'Leader' },
  leader: { code: 'L', label: 'Leader' },
  p: { code: 'P', label: 'Promo' },
  promo: { code: 'P', label: 'Promo' },
  sp: { code: 'SP', label: 'Special Card' },
  'special card': { code: 'SP', label: 'Special Card' },
  tr: { code: 'TR', label: 'Treasure Rare' },
  'treasure rare': { code: 'TR', label: 'Treasure Rare' },
};

export function normaliseRarity(raw: string | null | undefined): OpRarity {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { code: 'UNKNOWN', raw: '', label: 'Unknown' };
  const hit = CANONICAL[trimmed.toLowerCase()];
  if (hit) return { code: hit.code, raw: trimmed, label: hit.label };
  return { code: 'UNKNOWN', raw: trimmed, label: trimmed };
}
