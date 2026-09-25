// One Piece game-specific fields live inside the shared `tcg_cards.gamedata`
// JSON column. This module isolates the parse — every consumer reads the
// typed OpGamedata shape rather than pushing untyped `Record<string, unknown>`
// through the UI.
//
// We take a very defensive approach: unknown gamedata is common, so every
// field is optional and we never throw. Fields we know from the OPCG
// vocabulary:
//
//   * type          — one of Leader / Character / Event / Stage / DON!!
//   * colours       — string[] of colour names
//   * cost          — number (DON!! cost; not applicable to Leaders)
//   * power         — number (Leaders & Characters)
//   * counter       — number (Characters that can be tapped as counters)
//   * life          — number (Leaders only)
//   * attribute     — string, e.g. "Slash", "Strike", "Ranged", "Special",
//                     "Wisdom"
//   * trigger       — string (Trigger effect text) or boolean
//   * types         — string[] of type/crew tags, e.g.
//                     ["Straw Hat Crew", "Supernovas"]
//   * language      — 'en' | 'jp' | ...
//   * treatments    — string[] of treatment tags derived at ingest time

import { normaliseCardType, type OpCardType } from './card-type';
import { parseColours, type OpColour } from './colour';

export interface OpGamedata {
  type: OpCardType | null;
  colours: OpColour[];
  cost: number | null;
  power: number | null;
  counter: number | null;
  life: number | null;
  attribute: string | null;
  trigger: string | null;
  types: string[];
  language: string | null;
  effectText: string | null;
  triggerText: string | null;
}

export const EMPTY_GAMEDATA: OpGamedata = {
  type: null,
  colours: [],
  cost: null,
  power: null,
  counter: null,
  life: null,
  attribute: null,
  trigger: null,
  types: [],
  language: null,
  effectText: null,
  triggerText: null,
};

export function toOpGamedata(raw: unknown): OpGamedata {
  if (!raw || typeof raw !== 'object') return EMPTY_GAMEDATA;
  const src = raw as Record<string, unknown>;

  return {
    type: normaliseCardType(src['type'] ?? src['card_type']),
    colours: parseColours(src['colours'] ?? src['colors'] ?? src['color']),
    cost: numberOrNull(src['cost']),
    power: numberOrNull(src['power']),
    counter: numberOrNull(src['counter']),
    life: numberOrNull(src['life']),
    attribute: stringOrNull(src['attribute']),
    trigger:
      typeof src['trigger'] === 'boolean'
        ? src['trigger']
          ? 'Yes'
          : null
        : stringOrNull(src['trigger']),
    types: stringArray(src['types'] ?? src['type_tags'] ?? src['crew']),
    language: stringOrNull(src['language']),
    effectText: stringOrNull(src['effect'] ?? src['effect_text'] ?? src['text']),
    triggerText: stringOrNull(src['trigger_text']),
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
