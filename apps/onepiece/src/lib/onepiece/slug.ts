// URL slug helpers.
//
// Card-name → slug is the shape that shows up in URLs everywhere:
//   /card/monkey-d-luffy
//   /set/op01/card/op01-001-monkey-d-luffy
//
// Card names contain apostrophes, ellipses, dots and Japanese
// characters; we lower-case, strip non-word characters, collapse runs
// of whitespace, and de-duplicate hyphens. Round-tripping isn't
// guaranteed — the slug is a lookup key, not a canonical form.

export function slugifyCardName(name: string): string {
  return (name ?? '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Combines a printing's collector number with its slug. Used on the
 *  per-printing URL: `${cn}-${slug}`. Collector numbers may contain
 *  characters like `*` or `★` — those are percent-encoded upstream in
 *  the sitemap and link builder. */
export function buildPrintingSlug(collectorNumber: string | null, name: string): string {
  const slug = slugifyCardName(name);
  const cn = (collectorNumber ?? '').trim();
  if (!cn) return slug;
  return `${slugifyCollector(cn)}-${slug}`;
}

export function slugifyCollector(cn: string): string {
  return cn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Try to split a `${cn}-${slug}` string back into its two parts.
 *  Because collector numbers may themselves contain hyphens, we return
 *  every plausible split so the caller can look each candidate up. */
export function candidatePrintingSplits(
  combined: string,
): Array<{ collectorSlug: string; nameSlug: string }> {
  const parts = combined.split('-');
  const out: Array<{ collectorSlug: string; nameSlug: string }> = [];
  for (let i = 1; i < parts.length; i++) {
    out.push({
      collectorSlug: parts.slice(0, i).join('-'),
      nameSlug: parts.slice(i).join('-'),
    });
  }
  return out;
}
