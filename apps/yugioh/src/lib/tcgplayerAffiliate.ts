// Yu-Gi-Oh! TCGplayer affiliate URL builder.
//
// CN-05 Sprint 4 — Impact share-link deep-link pattern verified
// end-to-end. Mirrors the PokePrices helper but hardcodes
// game='yugioh' so YGO call sites don't need to know TCGplayer
// category slugs.
//
// Site base link (user-confirmed, approved for all 5 sites):
//   https://partner.tcgplayer.com/k4EaNV
//
// Two destination modes:
//   * exact-product — pass `productId` when `tcg_printings.tcgplayer_id`
//     is present on the printing row. Label: "View on TCGplayer".
//   * search        — productId is null. Falls back to the YGO
//     search URL. Label: "Find on TCGplayer".

const PARTNER_BASE = 'https://partner.tcgplayer.com/k4EaNV';

export interface YugiohTcgplayerLinkInput {
  cardName: string;
  /** Optional printing collector number — adds specificity to the
   *  search query ("Blue-Eyes White Dragon SDK-001"). */
  collectorNumber?: string | null;
  /** Verified TCGplayer product ID from `tcg_printings.tcgplayer_id`.
   *  If omitted / non-numeric, the resolver falls back to search. */
  productId?: string | number | null;
  /** Impact SubID (sharedid). Used for per-placement attribution.
   *  Capped at 70 chars by Impact. */
  subid?: string;
}

export interface TcgplayerLink {
  href: string;
  /** True when the destination is a specific TCGplayer product page. */
  isExact: boolean;
  /** CTA label (honest about search vs product). */
  label: string;
}

function toProductUrl(id: string | number): string {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(String(id))}`;
}

function toSearchUrl(query: string): string {
  return `https://www.tcgplayer.com/search/yugioh/product?q=${encodeURIComponent(query)}`;
}

function wrap(destination: string, subid: string | undefined): string {
  const u = new URL(PARTNER_BASE);
  u.searchParams.set('u', destination);
  if (subid) {
    const trimmed = subid.length > 70 ? subid.slice(0, 70) : subid;
    u.searchParams.set('sharedid', trimmed);
  }
  return u.toString();
}

export function buildYugiohTcgplayerLink(
  input: YugiohTcgplayerLinkInput,
): TcgplayerLink {
  const idStr = input.productId == null ? '' : String(input.productId).trim();
  const hasExact = idStr.length > 0 && /^[0-9]+$/.test(idStr);
  if (hasExact) {
    return {
      href: wrap(toProductUrl(idStr), input.subid),
      isExact: true,
      label: 'View on TCGplayer',
    };
  }

  const name = (input.cardName ?? '').trim();
  const num = (input.collectorNumber ?? '').trim();
  const query = num ? `${name} ${num}`.trim() : name;
  if (query.length === 0) {
    // Degenerate input — browse-only landing to the YGO section.
    return {
      href: wrap(toSearchUrl('cards'), input.subid),
      isExact: false,
      label: 'Browse on TCGplayer',
    };
  }

  return {
    href: wrap(toSearchUrl(query), input.subid),
    isExact: false,
    label: 'Find on TCGplayer',
  };
}
