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
//   "Ectoplasmic Fortification"              → ectoplasmic-fortification
//   "Ectoplasmic Fortification!"             → ectoplasmic-fortification--x
//   "How Did Dai Get Here?"                  → how-did-dai-get-here--q
//   "Bingo Machine, Go!!!"                   → bingo-machine-go--xxx

export function toCardSlug(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining-diacritic block
    .replace(/[‘’'`]/g, ''); // apostrophes disappear (Collector's → collectors)

  // Yu-Gi-Oh! uses `!` and `?` to distinguish otherwise-identical card
  // names (see "Ectoplasmic Fortification" collision found in Sept 23
  // 2026 verification). Both characters would otherwise collapse into
  // whitespace and produce the same slug. Encode them as a stable
  // short suffix so distinct names produce distinct URLs.
  //
  // Each `!` → `x`, each `?` → `q`, positional order preserved,
  // separated from the base by a double dash. Only kicks in when the
  // name actually contains these characters — every other YGO slug
  // stays unchanged.
  const marks: string[] = [];
  for (const c of normalized) {
    if (c === '!') marks.push('x');
    else if (c === '?') marks.push('q');
  }

  const base = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return marks.length > 0 ? `${base}--${marks.join('')}` : base;
}

// Slug → ILIKE pattern. Because slugs are lossy we build a pattern
// that lets the DB match any name whose slugged form equals ours. The
// pattern replaces our dashes with `%` and we filter results by
// re-slugging the DB name for exact-match confirmation. This handles
// apostrophes, colons, and other punctuation without a name→slug
// column in the DB.
//
// The `!`/`?` disambiguator suffix (e.g. `--x`, `--q`, `--xq`) is
// stripped before pattern construction — those characters are not in
// the source name; slugMatches() re-verifies the exact match after.
export function slugToIlikePattern(slug: string): string {
  const base = slug.replace(/--[xq]+$/, '');
  const escaped = base.replace(/[%_]/g, (m) => `\\${m}`);
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
