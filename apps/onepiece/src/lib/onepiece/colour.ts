// One Piece card colour vocabulary. Six colours: Red, Green, Blue,
// Purple, Black, Yellow. Cards may be single- or multi-coloured.
//
// Kept as data + tiny helpers so filters, chips and colour rails share
// one source of truth for token → label → CSS class.

export type OpColour = 'red' | 'green' | 'blue' | 'purple' | 'black' | 'yellow';

export const OP_COLOURS: readonly OpColour[] = [
  'red',
  'green',
  'blue',
  'purple',
  'black',
  'yellow',
] as const;

export const OP_COLOUR_LABEL: Record<OpColour, string> = {
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  black: 'Black',
  yellow: 'Yellow',
};

export const OP_COLOUR_CHIP_CLASS: Record<OpColour, string> = {
  red: 'chip chip-red',
  green: 'chip chip-green',
  blue: 'chip chip-blue',
  purple: 'chip chip-purple',
  black: 'chip chip-black',
  yellow: 'chip chip-yellow',
};

export function parseColours(input: unknown): OpColour[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : [input];
  const out: OpColour[] = [];
  const seen = new Set<OpColour>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const normalised = item.trim().toLowerCase();
    if (!isOpColour(normalised)) continue;
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    out.push(normalised);
  }
  return out;
}

export function isOpColour(v: string): v is OpColour {
  return OP_COLOURS.includes(v as OpColour);
}
