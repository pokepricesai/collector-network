// Lorcana's six inks — the primary discovery colour axis.
//
// Six inks, canonical order per the official ink wheel:
//   Amber, Amethyst, Emerald, Ruby, Sapphire, Steel.
//
// Cards may have a single ink (typical) or be Dual-Ink (rare — usually
// Illumineer's Quest cards). The gamedata.ink field is normally a
// single string; we still parse tolerantly and preserve order.

export type LcInk =
  | 'amber'
  | 'amethyst'
  | 'emerald'
  | 'ruby'
  | 'sapphire'
  | 'steel';

export const LC_INKS: readonly LcInk[] = [
  'amber',
  'amethyst',
  'emerald',
  'ruby',
  'sapphire',
  'steel',
] as const;

export const LC_INK_LABEL: Record<LcInk, string> = {
  amber: 'Amber',
  amethyst: 'Amethyst',
  emerald: 'Emerald',
  ruby: 'Ruby',
  sapphire: 'Sapphire',
  steel: 'Steel',
};

/** Semantic descriptors used in tooltips + ink discovery blurbs.
 *  Kept short — this is chip subtext, not lore. */
export const LC_INK_DESCRIPTOR: Record<LcInk, string> = {
  amber: 'radiant, healing, community',
  amethyst: 'mystic, ethereal, whimsy',
  emerald: 'trickster, deception, guile',
  ruby: 'passion, aggression, glory',
  sapphire: 'wisdom, invention, artifice',
  steel: 'resilience, courage, force',
};

/** Chip class token — Tailwind classes live in globals.css. */
export function inkChipClass(ink: LcInk): string {
  return `chip chip-ink chip-ink--${ink}`;
}

export function parseInks(input: unknown): LcInk[] {
  if (input == null) return [];
  const raw = Array.isArray(input) ? input : [input];
  const out: LcInk[] = [];
  const seen = new Set<LcInk>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const normalised = item.trim().toLowerCase();
    if (!isLcInk(normalised)) continue;
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    out.push(normalised);
  }
  return out;
}

export function isLcInk(v: string): v is LcInk {
  return LC_INKS.includes(v as LcInk);
}

export function inkSlug(ink: LcInk): string {
  return ink;
}

export function inkFromSlug(slug: string): LcInk | null {
  const s = slug.toLowerCase();
  return isLcInk(s) ? s : null;
}
