import Link from 'next/link';
import type { LcPrintingView, LcCardView } from '@/server/read';
import { buildEbaySearchUrl } from '@/lib/lorcana/ebay';
import { buildPrintingSlug } from '@/lib/lorcana/slug';
import TreatmentPrice from './TreatmentPrice';
import { DEFAULT_CURRENCY, type LorcanaCurrency } from '@/lib/currency';

// A single treatment block — headline + price bucket + fingerprint +
// eBay affiliate CTA. On the logical card page we render several of
// these stacked; on the printing page we render only the current one
// (larger).

export default function TreatmentPanel({
  cardView,
  printingView,
  linkToPrinting,
  currency = DEFAULT_CURRENCY,
}: {
  cardView: LcCardView;
  printingView: LcPrintingView;
  linkToPrinting: boolean;
  currency?: LorcanaCurrency;
}) {
  const { treatment, pricing, printing, set } = printingView;
  const setLabel = set?.code?.toUpperCase() ?? '—';
  const fingerprint = [
    setLabel,
    printing.collector_number ?? '—',
    treatment.short,
  ];

  const ebay = buildEbaySearchUrl({
    cardName: cardView.card.name,
    setName: set?.name,
    treatmentLabel: treatment.label,
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
          </span>
          <span
            className="lc-fingerprint"
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

      <TreatmentPrice pricing={pricing} currency={currency} />

      <div
        className="lc-engraved"
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
