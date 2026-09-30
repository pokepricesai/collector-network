import Link from 'next/link';
import type { OpPrintingView, OpCardView } from '@/server/read';
import { buildEbaySearchUrl } from '@/lib/onepiece/ebay';
import { buildPrintingSlug, baseCollectorNumber } from '@/lib/onepiece/slug';
import type { OpCurrency } from '@/lib/onepiece/currency';
import TreatmentPrice from './TreatmentPrice';

// A single treatment block — headline + price bucket + fingerprint +
// eBay affiliate CTA. On the logical card page we render several of
// these stacked; on the printing page we render only the current one
// (larger).

export default function TreatmentPanel({
  cardView,
  printingView,
  linkToPrinting,
  imageUrl,
  currency,
}: {
  cardView: OpCardView;
  printingView: OpPrintingView;
  linkToPrinting: boolean;
  /** Optional thumbnail. Set on the base card overview so distinct
   *  parallel art is visible without opening the variant page. Kept
   *  off the variant page (all rows share the same image). */
  imageUrl?: string | null;
  /** Currency preference from the request cookie. Forwarded to the
   *  price row so labels read "Cardmarket 30-day average" (EUR) or
   *  "TCGPlayer marketplace low" (USD), never generic "Retail". */
  currency?: OpCurrency;
}) {
  const { treatment, pricing, printing, set, variantIndex } = printingView;
  const setLabel = set?.code?.toUpperCase() ?? '–';
  // Fingerprint drops the internal `_p#` / `_r#` suffix from the
  // visible collector number — the variant index is already carried
  // by the treatment badge above (e.g. "Parallel #2"). Finish is
  // omitted for OP because our nonfoil / foil DB rows share a single
  // marketplace product id, so a visible finish label would falsely
  // imply two distinct purchasable products.
  const baseCollector = baseCollectorNumber(printing.collector_number) ?? '–';
  const treatmentToken =
    variantIndex != null ? `${treatment.short}${variantIndex}` : treatment.short;
  const fingerprint = [
    setLabel,
    baseCollector,
    treatmentToken,
    printing.language?.toUpperCase() ?? 'EN',
  ];

  // eBay query strategy: narrow by base collector number + treatment
  // discriminator so a "Boa Hancock" search stops returning Japanese
  // OP07-051 copies. The internal `_p1`/`_p2` suffix is our slug, not
  // a token sellers write in listing titles, so we ship the BASE
  // collector (OP07-038) and add a DB-derived treatment word
  // (parallel / secret rare / treasure rare / special card / promo /
  // reprint) which IS how sellers describe the variant. Standard rows
  // ship without a modifier — the base collector alone is already
  // discriminating enough.
  const baseCn = baseCollectorNumber(printing.collector_number);
  const treatmentModifier =
    treatment.code === 'standard' || treatment.code === 'leader'
      ? null
      : treatment.label.toLowerCase();
  const ebay = buildEbaySearchUrl({
    cardName: cardView.card.name,
    setName: set?.name,
    collectorNumber: baseCn ?? printing.collector_number ?? null,
    treatmentLabel: treatmentModifier,
    language: printing.language,
    source: 'treatment-panel',
  });

  const slug = buildPrintingSlug(printing.collector_number, cardView.card.name);
  const detailHref = set
    ? `/set/${encodeURIComponent(set.code.toLowerCase())}/card/${encodeURIComponent(slug)}`
    : null;

  const inner = (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 0 }}>
          {imageUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={imageUrl}
              alt={`${cardView.card.name} ${baseCollector} ${treatment.label}${variantIndex != null ? ` #${variantIndex}` : ''}`}
              loading="lazy"
              style={{
                width: 60,
                aspectRatio: '5 / 7',
                objectFit: 'cover',
                borderRadius: 6,
                background: 'var(--bg-light)',
                flex: '0 0 auto',
              }}
            />
          )}
          <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
            <span
              className={`treatment-badge treatment-badge--${treatment.code}`}
              style={{ width: 'fit-content' }}
            >
              {treatment.label}
              {variantIndex != null && ` #${variantIndex}`}
            </span>
            <span
              className="op-fingerprint"
              style={{ width: 'fit-content' }}
              aria-label="Printing fingerprint"
            >
              {fingerprint.map((part, i) => (
                <span key={i}>
                  {i > 0 && <span className="sep">·</span>}
                  {' '}
                  {part}
                </span>
              ))}
            </span>
          </div>
        </div>
      </div>

      <TreatmentPrice pricing={pricing} currency={currency} />

      <div
        className="op-engraved"
        aria-hidden
        style={{ margin: '14px 0' }}
      />

      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <a
          href={ebay}
          target="_blank"
          rel="nofollow sponsored noopener"
          className="btn btn-sm btn-primary"
          style={{ textDecoration: 'none' }}
        >
          Find on eBay
        </a>
        {linkToPrinting && detailHref && (
          <Link
            href={detailHref}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--primary)',
              textDecoration: 'none',
            }}
          >
            Printing detail →
          </Link>
        )}
      </div>
    </>
  );

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: 18,
      }}
    >
      {inner}
    </div>
  );
}
