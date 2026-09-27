// Small unobtrusive eBay Partner Network disclosure. Rendered at the
// bottom of any page that shows a "Find on eBay" affiliate CTA (card /
// logical card / set / market). Matches the `*` footnote marker
// beside the CTA button.

export default function EbayAffiliateDisclosure() {
  return (
    <p
      style={{
        marginTop: 32,
        marginBottom: 0,
        fontSize: 11,
        lineHeight: 1.55,
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      * Affiliate link. OnePiecePrices may earn a commission from
      qualifying purchases at no additional cost to you.
    </p>
  );
}
