import Link from 'next/link';
import type { OpPrintingView, OpCardView } from '@/server/read';
import { buildEbaySearchUrl } from '@/lib/onepiece/ebay';
import { buildPrintingSlug } from '@/lib/onepiece/slug';
import TreatmentPrice from './TreatmentPrice';

// A single treatment block — headline + price bucket + fingerprint +
// eBay affiliate CTA. On the logical card page we render several of
// these stacked; on the printing page we render only the current one
// (larger).

export default function TreatmentPanel({
  cardView,
  printingView,
  linkToPrinting,
}: {
  cardView: OpCardView;
  printingView: OpPrintingView;
  linkToPrinting: boolean;
}) {
  const { treatment, pricing, printing, set, variantIndex } = printingView;
  const setLabel = set?.code?.toUpperCase() ?? '—';
  const finishLabel = printing.finish?.toUpperCase() ?? null;
  // The variant index (`_p2` → 2) is the collector-relevant fingerprint
  // when it exists. Chase treatments (SEC / SP CARD / TR) don't have it.
  const treatmentToken =
    variantIndex != null ? `${treatment.short}${variantIndex}` : treatment.short;
  const fingerprint = [
    setLabel,
    printing.collector_number ?? '—',
    treatmentToken,
    ...(finishLabel ? [finishLabel] : []),
    printing.language?.toUpperCase() ?? 'EN',
  ];

  const ebayTreatmentLabel =
    variantIndex != null
      ? `${treatment.label} #${variantIndex}`
      : treatment.label;
  const ebay = buildEbaySearchUrl({
    cardName: cardView.card.name,
    setName: set?.name,
    treatmentLabel: ebayTreatmentLabel,
    language: printing.language,
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
        <div style={{ display: 'grid', gap: 4 }}>
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

      <TreatmentPrice pricing={pricing} />

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
