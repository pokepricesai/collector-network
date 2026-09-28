// Small unobtrusive eBay Partner Network disclosure. Rendered at the
// bottom of any page with a "Find on eBay" affiliate CTA (card,
// printing, set, market).

export default function EbayAffiliateDisclosure() {
  return (
    <p style={{
      marginTop: 32, marginBottom: 0,
      fontSize: 11, lineHeight: 1.55,
      color: 'var(--ygo-text-muted, #6B7280)',
      textAlign: 'center',
    }}>
      * Affiliate link. YGOPrices may earn a commission from qualifying
      purchases at no additional cost to you.
    </p>
  );
}
