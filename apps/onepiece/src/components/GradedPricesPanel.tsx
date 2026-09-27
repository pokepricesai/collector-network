// Graded market panel. Renders only when at least one slabbed quote
// exists for the anchor — never "$0", never fabricated. Card-
// attributed rows carry a "family estimate" disclosure so a viewer
// can never confuse a family price for an exact-printing quote.

import { buildGradedView, type GradedCell } from '@/lib/onepiece/graded-view';
import type { TcgGradedRow } from '@/server/graded';

interface Props {
  rows: readonly TcgGradedRow[];
  setCode: string;
  collectorNumber: string | null;
  finish: string | null;
}

function formatPrice(price: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency} ${price.toFixed(2)}`;
  }
}

function daysAgo(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const diff = Math.max(0, Math.round((now - t) / 86_400_000));
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 30) return `${diff}d ago`;
  if (diff < 60) return '1mo ago';
  return `${Math.round(diff / 30)}mo ago`;
}

function graderBadgeColor(g: string): string {
  const l = g.toLowerCase();
  if (l === 'psa') return '#c0392b';
  if (l === 'bgs') return '#1f6feb';
  if (l === 'cgc') return '#2ea44f';
  if (l === 'sgc') return '#f0b429';
  return '#8892a6';
}

function Fingerprint({
  setCode,
  collectorNumber,
  finish,
}: {
  setCode: string;
  collectorNumber: string | null;
  finish: string | null;
}) {
  return (
    <span
      aria-label="This exact printing"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        borderRadius: 999,
        background: 'var(--bg-light)',
        border: '1px solid var(--border)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
        color: 'var(--text-muted)',
      }}
    >
      <span>{setCode}</span>
      {collectorNumber && (
        <>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>#{collectorNumber}</span>
        </>
      )}
      {finish && finish !== 'nonfoil' && (
        <>
          <span style={{ opacity: 0.4 }}>/</span>
          <span>{finish.replace(/_/g, ' ')}</span>
        </>
      )}
    </span>
  );
}

function Cell({ c, hero }: { c: GradedCell; hero?: boolean }) {
  return (
    <div
      style={{
        padding: hero ? 14 : 12,
        borderRadius: 10,
        background: hero ? 'var(--surface)' : 'var(--bg-light)',
        border: '1px solid var(--border)',
        display: 'grid',
        gap: 6,
        boxShadow: hero ? '0 2px 8px rgba(20,33,61,0.04)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-label={`${c.grader} grader`}
          style={{
            padding: '2px 7px',
            borderRadius: 6,
            background: graderBadgeColor(c.grader),
            color: '#fff',
            fontSize: 10.5,
            fontWeight: 800,
            letterSpacing: '0.05em',
          }}
        >
          {c.grader}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
          Grade {c.grade}
        </span>
        {c.attribution === 'card' && (
          <span
            title="Family estimate — this quote is tied to the card family, not this exact printing."
            style={{
              padding: '1px 6px',
              borderRadius: 6,
              background: 'transparent',
              border: '1px dashed var(--border-strong, var(--border))',
              color: 'var(--text-muted)',
              fontSize: 9.5,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              fontWeight: 700,
            }}
          >
            Family
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: hero ? 20 : 16,
          fontWeight: 800,
          color: 'var(--text-strong)',
        }}
      >
        {formatPrice(c.price, c.currency)}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {c.currency}
        {c.updatedAt && <> · updated {daysAgo(c.updatedAt)}</>}
      </div>
    </div>
  );
}

export function GradedPricesPanel({ rows, setCode, collectorNumber, finish }: Props) {
  const view = buildGradedView(rows);
  if (!view.hasSlabbedData) return null;

  return (
    <section
      aria-label="Graded card prices"
      style={{
        padding: 20,
        borderRadius: 16,
        background: 'linear-gradient(180deg, var(--surface) 0%, var(--bg-light) 100%)',
        border: '1px solid var(--border)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
            Graded market
          </div>
          <h2
            style={{
              margin: '4px 0 6px',
              fontFamily: 'Outfit, system-ui, sans-serif',
              fontSize: 19,
              lineHeight: 1.2,
              fontWeight: 700,
              letterSpacing: '-0.005em',
              color: 'var(--text-strong)',
            }}
          >
            Graded card prices
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--text-muted)',
              maxWidth: 520,
              lineHeight: 1.55,
            }}
          >
            Live PSA, BGS, CGC and SGC market estimates for professionally graded copies of this
            exact printing. Rows tagged &ldquo;Family&rdquo; are estimated from card-family sales
            data where the source did not distinguish edition or finish.
          </p>
        </div>
        <Fingerprint setCode={setCode} collectorNumber={collectorNumber} finish={finish} />
      </header>

      {view.slabTen.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            marginBottom: view.anyGraded.length > 0 ? 14 : 0,
          }}
        >
          {view.slabTen.map((c) => (
            <Cell key={`${c.grader}-${c.grade}-${c.currency}`} c={c} hero />
          ))}
        </div>
      )}

      {view.anyGraded.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              margin: '4px 0 8px',
            }}
          >
            Other grades
          </div>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            }}
          >
            {view.anyGraded.map((c) => (
              <Cell key={`${c.grader}-${c.grade}-${c.currency}`} c={c} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
