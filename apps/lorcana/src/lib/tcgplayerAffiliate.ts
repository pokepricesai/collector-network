// Lorcana TCGplayer affiliate URL builder.
//
// CN-05 Sprint 4 — Impact share-link deep-link pattern verified
// end-to-end. Hardcodes game='lorcana' so Lorcana call sites don't
// need to know TCGplayer category slugs.
//
// Base link (user-confirmed, approved for all 5 sites):
//   https://partner.tcgplayer.com/k4EaNV
//
// Exact-product URL when `tcg_printings.tcgplayer_id` is numeric;
// per-game search URL otherwise with an honest "Find on TCGplayer"
// label.

const PARTNER_BASE = 'https://partner.tcgplayer.com/k4EaNV';

export interface LorcanaTcgplayerLinkInput {
  cardName: string;
  /** Optional collector number — appended to the search query. */
  collectorNumber?: string | null;
  /** Verified TCGplayer product ID from `tcg_printings.tcgplayer_id`. */
  productId?: string | number | null;
  /** Impact SubID (sharedid). */
  subid?: string;
}

export interface LorcanaTcgplayerLink {
  href: string;
  isExact: boolean;
  label: string;
}

function toProductUrl(id: string | number): string {
  return `https://www.tcgplayer.com/product/${encodeURIComponent(String(id))}`;
}

function toSearchUrl(query: string): string {
  return `https://www.tcgplayer.com/search/lorcana/product?q=${encodeURIComponent(query)}`;
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

export function buildLorcanaTcgplayerLink(
  input: LorcanaTcgplayerLinkInput,
): LorcanaTcgplayerLink {
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
