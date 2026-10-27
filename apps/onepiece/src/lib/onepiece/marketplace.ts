// Marketplace deep-link builders for OnePiecePrices.
//
// When a `tcg_printings` row carries a `cardmarket_id` or
// `tcgplayer_id` we deep-link straight to that marketplace's product
// page. Sellers list under those product ids, so a click lands on the
// exact single a collector wants to buy. Search-URL fallback is used
// only when the id is missing.
//
// CN-05 Sprint 5: TCGplayer links now flow through the Impact share-
// link `tcgplayerAffiliateUrl` wrapper when the caller wants affiliate
// tracking. Cardmarket is not enrolled, so its helpers stay plain.

const OP_CARDMARKET_CATEGORY = 'OnePiece';

/** Cardmarket product page. `id` maps directly to Cardmarket's
 *  Products/Singles/{id} URL, which redirects to the current-name
 *  slug so we don't need to precompute a friendly product slug. */
export function cardmarketProductUrl(id: number | null | undefined): string | null {
  if (id == null || !Number.isFinite(id)) return null;
  return `https://www.cardmarket.com/en/${OP_CARDMARKET_CATEGORY}/Products/Singles/${id}`;
}

/** Cardmarket search fallback when we don't have a product id. Uses
 *  `searchString` with the exact base collector plus card name so the
 *  landing page is a narrow result list rather than the whole game.  */
export function cardmarketSearchUrl(cardName: string, baseCollector: string | null | undefined): string {
  const parts = [cardName, baseCollector ?? '', 'One Piece Card Game']
    .filter(Boolean)
    .join(' ');
  return `https://www.cardmarket.com/en/${OP_CARDMARKET_CATEGORY}/Products/Search?searchString=${encodeURIComponent(parts)}`;
}

/** TCGPlayer product page. `id` matches TCGPlayer's numeric
 *  productId; the URL redirects to the friendly product URL. */
export function tcgplayerProductUrl(id: number | null | undefined): string | null {
  if (id == null || !Number.isFinite(id)) return null;
  return `https://www.tcgplayer.com/product/${id}`;
}

/** TCGPlayer search fallback (advanced search) when we don't have a
 *  product id. The `q` parameter takes free text; collector-narrowed
 *  queries land on the correct listing without a category flip. */
export function tcgplayerSearchUrl(cardName: string, baseCollector: string | null | undefined): string {
  const q = [cardName, baseCollector ?? '', 'One Piece Card Game']
    .filter(Boolean)
    .join(' ');
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${encodeURIComponent(q)}`;
}

// ── Impact affiliate wrapping ─────────────────────────────────────
//
// CN-05 Sprint 5. Wraps a verified TCGplayer destination in the
// Impact share-link `?u=<encoded>&sharedid=<subid>` pattern (verified
// end-to-end in Sprint 4). No TCGplayer API access required.

const TCG_PARTNER_BASE = 'https://partner.tcgplayer.com/k4EaNV';

export interface TcgplayerAffiliateInput {
  cardName: string;
  baseCollector: string | null | undefined;
  productId: number | null | undefined;
  /** Impact SubID (sharedid). Capped at 70 chars by Impact. */
  subid?: string;
}

export interface TcgplayerAffiliateLink {
  href: string;
  isExact: boolean;
  /** CTA copy that reflects the destination honestly. */
  label: string;
}

/** Produce an Impact-wrapped TCGplayer URL. Returns `{isExact:true}`
 *  when the printing has a numeric `tcgplayer_id`; otherwise falls
 *  back to the per-game search URL with the same affiliate wrap. */
export function tcgplayerAffiliateUrl(input: TcgplayerAffiliateInput): TcgplayerAffiliateLink {
  const productHref = tcgplayerProductUrl(input.productId);
  const destination = productHref ?? tcgplayerSearchUrl(input.cardName, input.baseCollector);
  const u = new URL(TCG_PARTNER_BASE);
  u.searchParams.set('u', destination);
  if (input.subid) {
    const trimmed = input.subid.length > 70 ? input.subid.slice(0, 70) : input.subid;
    u.searchParams.set('sharedid', trimmed);
  }
  return {
    href: u.toString(),
    isExact: productHref != null,
    label: productHref != null ? 'View on TCGplayer' : 'Search TCGplayer',
  };
}
