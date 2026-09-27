// eBay affiliate URL builder — OnePiecePrices.
//
// Thin adapter over @collector-network/affiliate. The shared package
// handles EPN campaign wiring, marketplace routing and customid
// sanitisation. This module supplies the OP-specific game terminator
// so the search text lands on One Piece results.

import {
  buildEbaySearchLink,
  type EbayLink,
  type EbayMarketplace,
} from '@collector-network/affiliate';

const OP_CONFIG = {
  gameTerminator: 'One Piece Card Game',
  // 38292 (Collectible Card Games) — safe network-wide default.
} as const;

export interface EbayLinkParams {
  cardName: string;
  setName?: string | null;
  collectorNumber?: string | null;
  treatmentLabel?: string | null;
  language?: string | null;
  marketplace?: EbayMarketplace;
  /** Origin identifier for EPN customid analytics. Prefer stable
   *  short values, e.g. 'card-overview' or 'treatment-panel'. */
  source?: string | null;
}

/** Returns a full EbayLink (href, marketplace, affiliate flag, label). */
export function buildOnePieceEbayLink(params: EbayLinkParams): EbayLink {
  return buildEbaySearchLink(
    {
      cardName: params.cardName,
      setName: params.setName ?? null,
      collectorNumber: params.collectorNumber ?? null,
      modifier: params.treatmentLabel ?? undefined,
      language: params.language ?? null,
      marketplace: params.marketplace,
      source: params.source ?? null,
    },
    OP_CONFIG,
  );
}

/** Legacy string-only entry point kept for existing callers. */
export function buildEbaySearchUrl(params: EbayLinkParams): string {
  return buildOnePieceEbayLink(params).href;
}
