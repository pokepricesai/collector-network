// eBay affiliate URL builder for Lorcana.
//
// The full campaign wiring (EPN account, tracking IDs, category scoping)
// lands with the shared @collector-network/affiliate package. Until then
// this helper produces a plain eBay search URL for the exact
// printing / treatment. When the affiliate package arrives we swap the
// origin and layer campaign params on top; the public component contract
// does not change.

export interface EbayLinkParams {
  cardName: string;
  setName?: string | null;
  treatmentLabel?: string | null;
}

export function buildEbaySearchUrl(params: EbayLinkParams): string {
  const bits: string[] = [];
  bits.push(params.cardName);
  if (params.setName) bits.push(params.setName);
  if (params.treatmentLabel) bits.push(params.treatmentLabel);
  bits.push('disney lorcana');
  const q = bits.filter(Boolean).join(' ');
  const url = new URL('https://www.ebay.com/sch/i.html');
  url.searchParams.set('_nkw', q);
  url.searchParams.set('_sacat', '38292'); // Trading Card Games
  return url.toString();
}
