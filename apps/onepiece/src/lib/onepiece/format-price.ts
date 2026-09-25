// Currency-aware price formatting. Callers must pass the currency; we
// never guess. Handles USD, EUR, GBP, JPY plus a fallback that still
// uses the ISO code so odd currencies render legibly instead of "?".

const KNOWN: Record<string, { locale: string; opts: Intl.NumberFormatOptions }> = {
  USD: { locale: 'en-US', opts: { style: 'currency', currency: 'USD' } },
  EUR: { locale: 'en-IE', opts: { style: 'currency', currency: 'EUR' } },
  GBP: { locale: 'en-GB', opts: { style: 'currency', currency: 'GBP' } },
  JPY: {
    locale: 'ja-JP',
    opts: { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 },
  },
};

export function formatPrice(price: number | null | undefined, currency: string): string {
  if (price == null || Number.isNaN(price)) return '—';
  const upper = (currency ?? '').toUpperCase() || 'USD';
  const spec = KNOWN[upper];
  try {
    if (spec) {
      return new Intl.NumberFormat(spec.locale, spec.opts).format(price);
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: upper,
    }).format(price);
  } catch {
    return `${upper} ${price.toFixed(2)}`;
  }
}
