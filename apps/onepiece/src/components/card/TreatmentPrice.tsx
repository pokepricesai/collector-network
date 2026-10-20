import type { PrintingPricing } from '@collector-network/market-data';
import { formatPrice } from '@/lib/onepiece/format-price';
import { pickHeadlinePrice, HEADLINE_SIGNAL_LABEL } from '@/lib/onepiece/pick-headline';
import { CURRENCY_SOURCE_NAME, type OpCurrency } from '@/lib/onepiece/currency';

// Price summary for a single priced printing. Reads the caller's
// PrintingPricing (retail + attribution='printing' graded) and renders
// only the buckets that have data. Never mixes currencies.

// Turn a `RetailQuote.source` string into the marketplace it belongs
// to. Sources look like `tcggraph.tcgplayer` or
// `tcggraph.cardmarket` — we only need the trailing token. Anything
// unrecognised falls back to the currency's native source name (EUR
// → Cardmarket, USD → TCGPlayer) so a mislabelled row still gets a
// truthful native label rather than "Retail".
function sourceLabel(source: string | null | undefined, currency: OpCurrency): string {
  const s = (source ?? '').toLowerCase();
  if (s.includes('tcgplayer')) return 'TCGPlayer';
  if (s.includes('cardmarket')) return 'Cardmarket';
  return CURRENCY_SOURCE_NAME[currency];
}

export default function TreatmentPrice({
  pricing,
  currency,
}: {
  pricing: PrintingPricing;
  /** Currency preference from the request cookie. Defaults to USD to
   *  preserve prior behaviour when a caller hasn't wired the header
   *  yet. */
  currency?: OpCurrency;
}) {
  const cur: OpCurrency = currency ?? 'USD';
  const headline = pickHeadlinePrice(pricing.market, cur);

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

  if (!headline && !rawFloor && !gradedTop) {
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

  // Source-native price label: "Cardmarket 30-day average",
  // "Cardmarket marketplace low", "TCGPlayer 30-day average",
  // "TCGPlayer listing trend". NEVER the generic word "Retail" —
  // the user is entitled to see WHICH marketplace the number came
  // from and WHICH signal it represents.
  const sourceName = headline ? sourceLabel(headline.source, headline.currency) : null;
  const priceLabel = headline
    ? `${sourceName} ${HEADLINE_SIGNAL_LABEL[headline.signal].toLowerCase()}`
    : '';
  return (
    <div
      style={{
        display: 'grid',
        gap: 6,
      }}
    >
      {headline && (
        <PriceRow
          label={priceLabel}
          headline={formatPrice(headline.price, headline.currency)}
          detail={headline.finish ? headline.finish : sourceName ?? ''}
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
          color: accent === 'gold' ? 'var(--gold-600)' : 'var(--text-muted)',
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
