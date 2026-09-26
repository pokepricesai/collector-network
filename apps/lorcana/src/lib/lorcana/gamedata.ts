// Lorcana game-specific fields live inside the shared `tcg_cards.gamedata`
// JSON column. Verified 2026-09-26 in docs/lorcana/data-audit.md §7:
//
//   ink              string (Amber, Amethyst, Emerald, Ruby, Sapphire, Steel)
//   inkCost          integer
//   inkable          boolean
//   lore             integer | null       (characters only)
//   strength         integer | null       (characters only)
//   willpower        integer | null       (characters only)
//   moveCost         integer | null       (locations only)
//   cardType         "CHARACTER" | "ACTION" | "ITEM" | "LOCATION" | "ACTION - SONG"
//   version          string | null        (subtitle after " - " on characters)
//   classifications  string[]             (Storyborn / Villain / Sorcerer / …)
//
// Every field is optional at parse time — the composition layer decides
// which section to render based on cardType.

import { normaliseCardType, type LcCardType } from './card-type';
import { parseInks, type LcInk } from './ink';

export interface LcGamedata {
  cardType: LcCardType | null;
  inks: LcInk[];              // usually length 1; length 2 for dual-ink
  inkCost: number | null;
  inkable: boolean | null;
  lore: number | null;
  strength: number | null;
  willpower: number | null;
  moveCost: number | null;
  version: string | null;
  classifications: string[];
  effectText: string | null;
  flavourText: string | null;
}

export const EMPTY_GAMEDATA: LcGamedata = {
  cardType: null,
  inks: [],
  inkCost: null,
  inkable: null,
  lore: null,
  strength: null,
  willpower: null,
  moveCost: null,
  version: null,
  classifications: [],
  effectText: null,
  flavourText: null,
};

export function toLcGamedata(raw: unknown): LcGamedata {
  if (!raw || typeof raw !== 'object') return EMPTY_GAMEDATA;
  const src = raw as Record<string, unknown>;

  return {
    cardType: normaliseCardType(src['cardType'] ?? src['card_type'] ?? src['type']),
    inks: parseInks(src['ink'] ?? src['inks'] ?? src['color'] ?? src['colors']),
    inkCost: numberOrNull(src['inkCost'] ?? src['ink_cost'] ?? src['cost']),
    inkable:
      typeof src['inkable'] === 'boolean'
        ? (src['inkable'] as boolean)
        : boolOrNull(src['inkable']),
    lore: numberOrNull(src['lore']),
    strength: numberOrNull(src['strength']),
    willpower: numberOrNull(src['willpower']),
    moveCost: numberOrNull(src['moveCost'] ?? src['move_cost']),
    version: stringOrNull(src['version'] ?? src['subtitle']),
    classifications: stringArray(
      src['classifications'] ?? src['subtypes'] ?? src['types'],
    ),
    effectText: stringOrNull(
      src['effect'] ?? src['effectText'] ?? src['text'] ?? src['rulesText'],
    ),
    flavourText: stringOrNull(src['flavor'] ?? src['flavour'] ?? src['flavourText']),
  };
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function boolOrNull(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === 'yes' || t === '1') return true;
    if (t === 'false' || t === 'no' || t === '0') return false;
  }
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

function stringArray(v: unknown): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  const out: string[] = [];
  for (const item of arr) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
