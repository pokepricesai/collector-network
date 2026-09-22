// Yu-Gi-Oh! interpretation of the shared `tcg_cards.gamedata` JSON blob.
// Everything in this file is YGO-specific; it must not leak into
// @collector-network/database or @collector-network/market-data.
//
// Field names are the ones actually present in production (see
// docs/yugioh/data-audit.md § gamedata).

export type YugiohAttribute =
  | 'LIGHT'
  | 'DARK'
  | 'FIRE'
  | 'WATER'
  | 'WIND'
  | 'EARTH'
  | 'DIVINE';

export type YugiohBanlistState =
  | 'unlimited'
  | 'semi-limited'
  | 'limited'
  | 'forbidden'
  | (string & {});

export interface YugiohBanlist {
  tcg?: YugiohBanlistState;
  ocg?: YugiohBanlistState;
}

export interface YugiohGamedata {
  atk: number | null;
  def: number | null;
  race: string | null;
  level: number | null;
  attribute: YugiohAttribute | null;
  frameType: string | null;
  archetypes: string[];
  linkRating: number | null;
  linkMarkers: string[];
  pendulumScale: number | null;
  banlist: YugiohBanlist | null;
}

const EMPTY_GAMEDATA: YugiohGamedata = {
  atk: null,
  def: null,
  race: null,
  level: null,
  attribute: null,
  frameType: null,
  archetypes: [],
  linkRating: null,
  linkMarkers: [],
  pendulumScale: null,
  banlist: null,
};

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

// Cast the loose Record<string, unknown> from the shared tcg_cards row
// into a typed YugiohGamedata. Unknown values become nulls / empty arrays;
// unknown attribute strings pass through so future additions don't get
// silently dropped.
export function toYugiohGamedata(
  raw: Record<string, unknown> | null | undefined,
): YugiohGamedata {
  if (!raw) return EMPTY_GAMEDATA;
  const banlistRaw = raw['banlist'];
  const banlist =
    banlistRaw && typeof banlistRaw === 'object'
      ? {
          tcg: str((banlistRaw as Record<string, unknown>)['tcg']) ?? undefined,
          ocg: str((banlistRaw as Record<string, unknown>)['ocg']) ?? undefined,
        }
      : null;
  return {
    atk: num(raw['atk']),
    def: num(raw['def']),
    race: str(raw['race']),
    level: num(raw['level']),
    attribute: (str(raw['attribute']) as YugiohAttribute | null) ?? null,
    frameType: str(raw['frameType']),
    archetypes: strArray(raw['archetypes']),
    linkRating: num(raw['linkRating']),
    linkMarkers: strArray(raw['linkMarkers']),
    pendulumScale: num(raw['pendulumScale']),
    banlist,
  };
}
