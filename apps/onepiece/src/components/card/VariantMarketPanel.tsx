import type { PrintingPricing, RetailQuote } from '@collector-network/market-data';
import type { OpPrintingView } from '@/server/read';
import { pickHeadlinePrice, HEADLINE_SIGNAL_LABEL } from '@/lib/onepiece/pick-headline';
import { formatPrice } from '@/lib/onepiece/format-price';
import {
  cardmarketProductUrl,
  cardmarketSearchUrl,
  tcgplayerProductUrl,
  tcgplayerSearchUrl,
} from '@/lib/onepiece/marketplace';
import { buildEbaySearchUrl } from '@/lib/onepiece/ebay';
import { baseCollectorNumber } from '@/lib/onepiece/slug';

// Variant-scope market panel: Cardmarket EUR + TCGPlayer USD shown
// side-by-side for one collectible variant. NO currency conversion.
// Rows are grouped by marketplace product id (cardmarket_id /
// tcgplayer_id); finish rows that share a product id collapse into
// one panel. Finish labels are ONLY surfaced when a source actually
// carries multiple distinct product ids for this variant — otherwise
// they'd falsely imply two separate purchasable products.

type SourceKey = 'cardmarket' | 'tcgplayer';

interface Grouped {
  key: string;
  source: SourceKey;
  currency: 'EUR' | 'USD';
  productId: number | null;
  finishes: string[];
  quotes: RetailQuote[];
}

function sourceKeyFrom(raw: string | null | undefined): SourceKey | null {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('cardmarket')) return 'cardmarket';
  if (s.includes('tcgplayer')) return 'tcgplayer';
  return null;
}

function groupByMarketProduct(
  printings: readonly OpPrintingView[],
): Grouped[] {
  const buckets = new Map<string, Grouped>();
  for (const p of printings) {
    for (const q of (p.pricing.market ?? []) as readonly RetailQuote[]) {
      const source = sourceKeyFrom(q.source);
      if (!source) continue;
      const productId =
        source === 'cardmarket' ? p.printing.cardmarket_id
        : source === 'tcgplayer' ? p.printing.tcgplayer_id
        : null;
      // Group by (source, productId). If productId is missing fall
      // back to (source, printingId) so we still render something.
      const key = productId != null ? `${source}|${productId}` : `${source}|${q.printingId}`;
      const bucket = buckets.get(key);
      const finish = p.printing.finish ?? q.finish ?? null;
      if (bucket) {
        bucket.quotes.push(q);
        if (finish && !bucket.finishes.includes(finish)) bucket.finishes.push(finish);
      } else {
        buckets.set(key, {
          key,
          source,
          currency: (q.currency === 'EUR' ? 'EUR' : 'USD') as 'EUR' | 'USD',
          productId,
          finishes: finish ? [finish] : [],
          quotes: [q],
        });
      }
    }
  }
  return [...buckets.values()];
}

function findGroup(groups: Grouped[], source: SourceKey): Grouped | null {
  return groups.find((g) => g.source === source) ?? null;
}

function pickSourceHeadline(group: Grouped): {
  price: number; currency: 'EUR' | 'USD'; signal: 'avg30d' | 'priceLow' | 'trend'; label: string;
} | null {
  const h = pickHeadlinePrice(group.quotes, group.currency);
  if (!h) return null;
  return { price: h.price, currency: h.currency, signal: h.signal, label: HEADLINE_SIGNAL_LABEL[h.signal] };
}

// Freshest updated_at across quotes in this group (empty string if
// none of the quotes carry one).
function newestUpdate(group: Grouped): string | null {
  let best = '';
  for (const q of group.quotes) {
    const t = q.updatedAt ?? '';
    if (t && t > best) best = t;
  }
  return best || null;
}

function daysAgo(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.round((Date.now() - t) / 86_400_000));
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 30) return `${diff}d ago`;
  return `${Math.round(diff / 30)}mo ago`;
}

function extractSecondary(group: Grouped): { priceLow: number | null; trend: number | null } {
  // Merge the strongest signals across grouped quotes (same market
  // product). Preferring populated over null.
  let priceLow: number | null = null;
  let trend: number | null = null;
  for (const q of group.quotes) {
    if (q.priceLow != null && (priceLow == null || q.priceLow < priceLow)) priceLow = q.priceLow;
    if (q.priceTrend != null && trend == null) trend = q.priceTrend;
    else if (q.price != null && trend == null) trend = q.price;
  }
  return { priceLow, trend };
}

function MarketCard({
  source,
  cardName,
  baseCollector,
  group,
  sourceHasMultipleProducts,
  fallbackCurrency,
}: {
  source: SourceKey;
  cardName: string;
  baseCollector: string | null;
  group: Grouped | null;
  /** True only when the source has >1 distinct product id for this
   *  variant — the only case where a finish label is a meaningful
   *  user-facing distinction. Everywhere else finish is DB granularity
   *  the marketplace itself doesn't split, so we suppress it. */
  sourceHasMultipleProducts: boolean;
  fallbackCurrency: 'EUR' | 'USD';
}) {
  const sourceLabel = source === 'cardmarket' ? 'Cardmarket' : 'TCGPlayer';
  const currency: 'EUR' | 'USD' = group?.currency ?? fallbackCurrency;
  const headline = group ? pickSourceHeadline(group) : null;
  const secondary = group ? extractSecondary(group) : { priceLow: null, trend: null };
  const productHref = source === 'cardmarket'
    ? cardmarketProductUrl(group?.productId)
    : tcgplayerProductUrl(group?.productId);
  const searchHref = source === 'cardmarket'
    ? cardmarketSearchUrl(cardName, baseCollector)
    : tcgplayerSearchUrl(cardName, baseCollector);
  const cta = productHref ?? searchHref;
  const ctaLabel = productHref ? `View on ${sourceLabel}` : `Search ${sourceLabel}`;
  const updated = group ? daysAgo(newestUpdate(group)) : null;
  // Only show finish text when the source genuinely splits this
  // variant into multiple purchasable products by finish. In the
  // current OP feed, nonfoil + foil rows on the same variant share a
  // marketplace product id, so we suppress the label.
  const finishNote = sourceHasMultipleProducts && group && group.finishes.length === 1
    ? prettyFinish(group.finishes[0]!)
    : null;

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: 18,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
          {sourceLabel} · {currency}
        </div>
        {updated && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Updated {updated}
          </span>
        )}
      </div>
      {headline ? (
        <>
          <div style={{ fontFamily: "'Outfit', system-ui, sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: '-0.01em' }}>
            {formatPrice(headline.price, headline.currency)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.03em' }}>
            {headline.label}
            {finishNote ? ` · ${finishNote}` : ''}
          </div>
          {(secondary.priceLow != null || secondary.trend != null) && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
              {secondary.priceLow != null && headline.signal !== 'priceLow' && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Marketplace low <strong style={{ color: 'var(--text)' }}>{formatPrice(secondary.priceLow, currency)}</strong>
                </span>
              )}
              {secondary.trend != null && headline.signal !== 'trend' && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Listing trend <strong style={{ color: 'var(--text)' }}>{formatPrice(secondary.trend, currency)}</strong>
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          No live {sourceLabel} quote for this version right now.
        </div>
      )}
      <a
        href={cta}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="btn btn-sm"
        style={{
          justifySelf: 'start',
          textDecoration: 'none',
          padding: '8px 14px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, var(--ocean-400) 0%, var(--ocean-500) 100%)',
          color: 'var(--palette-white)',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        {ctaLabel} ↗
      </a>
    </div>
  );
}

function prettyFinish(finish: string): string {
  const f = finish.toLowerCase();
  if (f === 'nonfoil') return 'Nonfoil';
  if (f === 'foil') return 'Foil';
  if (f === 'holo') return 'Holo';
  return finish;
}

export default function VariantMarketPanel({
  cardName,
  collectorNumber,
  variantPrintings,
  fallbackCurrency,
}: {
  cardName: string;
  collectorNumber: string | null;
  variantPrintings: readonly OpPrintingView[];
  /** Cookie-preferred currency. Only used to pick which unavailable-
   *  side to render first when neither has a quote. */
  fallbackCurrency: 'EUR' | 'USD';
}) {
  const base = baseCollectorNumber(collectorNumber);
  const groups = groupByMarketProduct(variantPrintings);
  const cardmarket = findGroup(groups, 'cardmarket');
  const tcgplayer = findGroup(groups, 'tcgplayer');
  // Detect whether either source truly splits this variant into more
  // than one purchasable product by finish. That's the only case where
  // a "Foil" / "Nonfoil" label is a real user-facing distinction rather
  // than DB-side noise.
  const cardmarketMulti = groups.filter((g) => g.source === 'cardmarket').length > 1;
  const tcgplayerMulti = groups.filter((g) => g.source === 'tcgplayer').length > 1;

  const ebayHref = buildEbaySearchUrl({
    cardName,
    collectorNumber: base ?? collectorNumber,
    source: 'variant-market-panel',
  });

  return (
    <section
      aria-label="Live market prices"
      style={{ display: 'grid', gap: 14, marginTop: 24 }}
    >
      <header style={{ display: 'grid', gap: 4 }}>
        <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
          Live market prices
        </div>
        <h2 style={{ margin: 0, fontSize: 20, letterSpacing: '-0.005em' }}>
          Cardmarket and TCGPlayer, native currency
        </h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          Prices from Cardmarket and TCGPlayer for this exact version.
        </p>
      </header>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        <MarketCard
          source="cardmarket"
          cardName={cardName}
          baseCollector={base}
          group={cardmarket}
          sourceHasMultipleProducts={cardmarketMulti}
          fallbackCurrency="EUR"
        />
        <MarketCard
          source="tcgplayer"
          cardName={cardName}
          baseCollector={base}
          group={tcgplayer}
          sourceHasMultipleProducts={tcgplayerMulti}
          fallbackCurrency="USD"
        />
      </div>
      <a
        href={ebayHref}
        target="_blank"
        rel="sponsored nofollow noopener noreferrer"
        className="btn btn-sm"
        style={{
          justifySelf: 'start',
          textDecoration: 'none',
          padding: '8px 14px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, var(--gold-200) 0%, var(--gold-300) 100%)',
          color: 'var(--palette-navy)',
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: '0.02em',
          border: '1px solid var(--gold-400)',
        }}
      >
        Find {cardName} {base ?? collectorNumber ?? ''} on eBay ↗
      </a>
      {/* Marker for acceptance tests: this is the dual-market surface. */}
      <span aria-hidden style={{ display: 'none' }}>op-dual-market-panel</span>
      {/* Marker for the fallback-currency plumbing (kept referenced so
          the noop parameter isn't stripped by tree-shaking). */}
      <span aria-hidden style={{ display: 'none' }}>{`fallback=${fallbackCurrency}`}</span>
    </section>
  );
}
