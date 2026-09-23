// Name → URL slug helpers. Yu-Gi-Oh! names include apostrophes,
// hyphens, colons and Unicode punctuation. We normalise them into
// URL-safe segments and preserve enough information to look the card
// name back up from the slug via ILIKE.
//
// Slugging is lossy but reasonable:
//   "Blue-Eyes White Dragon"                 → blue-eyes-white-dragon
//   "Buster Blader, the Dragon Destroyer"    → buster-blader-the-dragon-destroyer
//   "D.D. Warrior"                           → dd-warrior
//   "Number 39: Utopia"                      → number-39-utopia
//   "Prohibition"                            → prohibition
//   "Silent Magician LV8"                    → silent-magician-lv8

export function toCardSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining-diacritic block
    .replace(/[‘’'`]/g, '') // apostrophes disappear (Collector's → collectors)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Slug → ILIKE pattern. Because slugs are lossy we build a pattern
// that lets the DB match any name whose slugged form equals ours. The
// pattern replaces our dashes with `%` and we filter results by
// re-slugging the DB name for exact-match confirmation. This handles
// apostrophes, colons, and other punctuation without a name→slug
// column in the DB.
export function slugToIlikePattern(slug: string): string {
  const escaped = slug.replace(/[%_]/g, (m) => `\\${m}`);
  return escaped.replace(/-/g, '%');
}

// True if the given DB name slugs to the same string.
export function slugMatches(dbName: string, slug: string): boolean {
  return toCardSlug(dbName) === slug;
}

// Printing key normalisation (URL segment).
// tcggraph_printing_key values in production: 'normal', '1st-edition',
// 'limited', 'foil'. We use these directly as URL segments — they're
// already URL-safe.
export type PrintingKey = string;

export function normalisePrintingKey(raw: string | null | undefined): PrintingKey {
  return (raw ?? 'normal').toLowerCase().trim();
}
