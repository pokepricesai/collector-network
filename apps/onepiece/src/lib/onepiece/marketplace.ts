// Marketplace deep-link builders for OnePiecePrices.
//
// When a `tcg_printings` row carries a `cardmarket_id` or
// `tcgplayer_id` we deep-link straight to that marketplace's product
// page. Sellers list under those product ids, so a click lands on the
// exact single a collector wants to buy. Search-URL fallback is used
// only when the id is missing.
//
// No affiliate tracking is attached today. If Cardmarket or TCGPlayer
// affiliate programs are enrolled later, gate the query-param tail on
// process.env and keep the product URL shape identical.

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
