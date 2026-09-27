// eBay affiliate URL builder — YGOPrices.
//
// Thin adapter over @collector-network/affiliate. Shared package
// handles EPN campaign wiring, marketplace routing and customid
// sanitisation.

import {
  buildEbaySearchLink,
  type EbayLink,
  type EbayMarketplace,
} from '@collector-network/affiliate';

const YGO_CONFIG = {
  // Yu-Gi-Oh! trading card game. Terminator has to end with the
  // trademark punctuation to match seller listings.
  gameTerminator: 'Yu-Gi-Oh! TCG',
} as const;

export interface EbayLinkParams {
  cardName: string;
  setName?: string | null;
  setCode?: string | null;
  collectorNumber?: string | null;
  /** e.g. 'Ultra Rare', '1st Edition', 'Ghost Rare', 'Starlight Rare'. */
  edition?: string | null;
  rarity?: string | null;
  /** For graded-slab queries. Combined into text search. */
  gradedLabel?: string | null;
  marketplace?: EbayMarketplace;
  source?: string | null;
}

/** Returns a full EbayLink (href, marketplace, affiliate flag, label). */
export function buildYugiohEbayLink(params: EbayLinkParams): EbayLink {
  const modifiers: string[] = [];
  if (params.rarity) modifiers.push(params.rarity);
  if (params.edition) modifiers.push(params.edition);
  if (params.gradedLabel) modifiers.push(params.gradedLabel);
  const modifier = modifiers.length ? modifiers.join(' ') : undefined;
  return buildEbaySearchLink(
    {
      cardName: params.cardName,
      setName: params.setName ?? null,
      setCode: params.setCode ?? null,
      collectorNumber: params.collectorNumber ?? null,
      modifier,
      marketplace: params.marketplace,
      source: params.source ?? null,
    },
    YGO_CONFIG,
  );
}

/** Legacy string-only entry point. */
export function buildEbaySearchUrl(params: EbayLinkParams): string {
  return buildYugiohEbayLink(params).href;
}
