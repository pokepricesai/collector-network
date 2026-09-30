import type { PrintingPricing } from '@collector-network/market-data';
import { formatPrice } from '@/lib/lorcana/format-price';
import { formatPrice as formatSelected } from '@/lib/currency';
import { selectPreferredRetailQuote } from '@collector-network/market-data';
import {
  CURRENCY_SOURCE_KEY,
  DEFAULT_CURRENCY,
  type LorcanaCurrency,
} from '@/lib/currency';

// Price summary for a single priced printing. Reads the caller's
// PrintingPricing (retail + attribution='printing' graded) and renders
// only the buckets that have data. Never mixes currencies. When
// `currency` is supplied we ONLY consider retail rows in that currency's
// native source (USD → TCGplayer, EUR → Cardmarket) — missing = show
// "No current price", never silently fall back to the other market.

export default function TreatmentPrice({
  pricing,
  currency = DEFAULT_CURRENCY,
}: {
  pricing: PrintingPricing;
  currency?: LorcanaCurrency;
}) {
  const nativeSource = CURRENCY_SOURCE_KEY[currency];
  const currencyScopedRetail = pricing.market.filter(
    (q) => q.currency === currency && q.source === nativeSource,
  );
  const preferred = selectPreferredRetailQuote(currencyScopedRetail, currency);

  const rawFloor = pickLowestNonNull(
    pricing.raw.map((r) => ({ price: r.price, currency: r.currency })),
  );
  const gradedTop = pickHighestNonNull(
    pricing.graded.map((g) => ({
      price: g.price,
      currency: g.currency,
      grader: g.grader,
      grade: g.grade,
    })),
  );

  if (!preferred && !rawFloor && !gradedTop) {
    return (
      <div
        className="label-mono"
        style={{
          color: 'var(--text-muted)',
          padding: '8px 0',
        }}
      >
        No priced observations yet
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
      }}
    >
      {preferred ? (
        <PriceRow
          label="Retail"
          headline={formatPrice(preferred.price, preferred.currency)}
          detail={`${preferred.source}${preferred.finish ? ' · ' + preferred.finish : ''}`}
        />
      ) : (
        <PriceRow
          label="Retail"
          headline={formatSelected(null, currency)}
          detail={`Native ${currency} feed`}
          muted
        />
      )}
      {rawFloor && (
        <PriceRow
          label="Raw"
          headline={formatPrice(rawFloor.price, rawFloor.currency)}
          detail="Ungraded floor"
          muted
        />
      )}
      {gradedTop && (
        <PriceRow
          label={`${gradedTop.grader.toUpperCase()} ${gradedTop.grade}`}
          headline={formatPrice(gradedTop.price, gradedTop.currency)}
          detail="Top graded quote"
          accent="gold"
        />
      )}
    </div>
  );
}

function PriceRow({
  label,
  headline,
  detail,
  muted,
  accent,
}: {
  label: string;
  headline: string;
  detail: string;
  muted?: boolean;
  accent?: 'gold';
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 12,
        padding: '4px 0',
      }}
    >
      <span
        className="label-mono"
        style={{
          color: accent === 'gold' ? 'var(--accent-2)' : 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span style={{ textAlign: 'right' }}>
        <span
          style={{
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 700,
            fontSize: muted ? 15 : 17,
            color: 'var(--text-strong)',
          }}
        >
          {headline}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 11,
            color: 'var(--text-muted)',
          }}
        >
          {detail}
        </span>
      </span>
    </div>
  );
}

function pickLowestNonNull<T extends { price: number | null }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.price == null) continue;
    if (best == null || r.price < (best.price ?? Infinity)) best = r;
  }
  return best;
}

function pickHighestNonNull<T extends { price: number | null }>(rows: T[]): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (r.price == null) continue;
    if (best == null || r.price > (best.price ?? -Infinity)) best = r;
  }
  return best;
}
