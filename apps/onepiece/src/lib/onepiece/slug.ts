// URL slug helpers.
//
// One Piece names are heavily reused across distinct game cards
// ("Roronoa Zoro" is 30+ separate cards). The logical-card URL MUST
// disambiguate by base collector number:
//   /card/op13-037-roronoa-zoro                    (Zoro from OP13)
//   /card/op01-001-roronoa-zoro                    (a different Zoro)
//   /set/op13/card/op13-037-roronoa-zoro           (exact printing)
//
// A "logical card" is one base card plus its parallels (_p1, _p2, ...)
// and reprints (_r1, _r2, ...). Two cards with the same character
// name but different base collector numbers are DIFFERENT logical
// cards and must not share a URL.

/** Strip the trailing `_p<n>` (parallel) or `_r<n>` (reprint) suffix
 *  from a collector number so `OP13-037_p1` and `OP13-037_r1` both
 *  reduce to `OP13-037` — the underlying "base" checklist slot. */
export function baseCollectorNumber(collector: string | null | undefined): string | null {
  if (!collector) return null;
  return collector.replace(/_(?:p|r)\d+$/i, '');
}

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

/** Logical-card URL builder. A "logical card" is one base card plus
 *  its parallels (_p*) and reprints (_r*) — NOT every card that
 *  happens to share a character name. The href is
 *  `/card/${baseCollectorSlug}-${nameSlug}`. Cards with no collector
 *  number fall back to a name-only slug (legacy behaviour) so promos
 *  without a printed number still work.
 *  Level A in the product model: base game card / overview. */
export function buildLogicalCardHref(collectorNumber: string | null, name: string): string {
  const base = baseCollectorNumber(collectorNumber);
  const slug = buildPrintingSlug(base, name);
  return `/card/${slug}`;
}

/** Exact-variant URL builder. Preserves the full collector number
 *  including any `_p1` / `_p2` / `_r1` suffix so a specific
 *  collectible variant gets its own route. This is where Card Finder
 *  tiles should link when the tile represents a specific priced
 *  variant. Requires the variant's set code. Level B in the product
 *  model: collectible variant / treatment / exact printing detail. */
export function buildVariantHref(
  setCode: string | null | undefined,
  collectorNumber: string | null,
  name: string,
): string {
  const code = (setCode ?? '').toLowerCase();
  const slug = buildPrintingSlug(collectorNumber, name);
  if (!code) return `/card/${slug}`;
  return `/set/${encodeURIComponent(code)}/card/${encodeURIComponent(slug)}`;
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
