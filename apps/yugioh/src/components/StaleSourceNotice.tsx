import {
  getYugiohSourceFreshness,
  staleSourceLabel,
  type YugiohRetailSource,
} from '../server/source-freshness';

//  Compact, honest freshness banner used wherever a specific
//  marketplace's USD or EUR prices are prominent (card page pricing
//  panel, /card-finder header, /market header, homepage USD area).
//
//  Renders NOTHING when the source is within the freshness threshold,
//  so it disappears automatically once the upstream feed resumes.
//
//  Deliberately unobtrusive: single line, dim border, no colour
//  alarm — the site is intentionally not screaming; it is disclosing.

interface Props {
  source: YugiohRetailSource;
  className?: string;
}

export async function StaleSourceNotice({ source, className }: Props) {
  const freshness = await getYugiohSourceFreshness(source);
  const label = staleSourceLabel(freshness);
  if (!label) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 12,
        border: '1px solid rgba(255, 200, 60, 0.35)',
        background: 'rgba(255, 200, 60, 0.06)',
        borderRadius: 8,
        fontSize: 12.5,
        lineHeight: 1.4,
        color: 'var(--ygo-text-muted, #b0a878)',
      }}
    >
      <span aria-hidden style={{ fontSize: 14, opacity: 0.7 }}>ℹ</span>
      <span>{label}</span>
    </div>
  );
}
