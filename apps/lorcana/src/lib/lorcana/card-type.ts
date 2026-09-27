// Lorcana's card categories. `gamedata.cardType` stores the value in
// UPPER SNAKE-CASE-ISH ("CHARACTER", "ITEM", "ACTION - SONG", etc.).
//
// We normalise into a small canonical set for filters and section
// gating. Songs are a sub-category of Action rendered on their own chip
// because they're the mechanic collectors and players search on.

export type LcCardType =
  | 'character'
  | 'action'
  | 'song'
  | 'item'
  | 'location';

export const LC_CARD_TYPES: readonly LcCardType[] = [
  'character',
  'action',
  'song',
  'item',
  'location',
] as const;

export const LC_CARD_TYPE_LABEL: Record<LcCardType, string> = {
  character: 'Character',
  action: 'Action',
  song: 'Song',
  item: 'Item',
  location: 'Location',
};

export function normaliseCardType(v: unknown): LcCardType | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().toLowerCase().replace(/\s+/g, ' ');
  switch (trimmed) {
    case 'character':
      return 'character';
    case 'action':
      return 'action';
    case 'action - song':
    case 'action-song':
    case 'song':
      return 'song';
    case 'item':
      return 'item';
    case 'location':
      return 'location';
    default:
      return null;
  }
}
