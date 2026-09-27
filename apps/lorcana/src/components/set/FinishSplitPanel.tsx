import type { FinishSplit } from '@/server/discovery';

// Foil vs nonfoil value split for a set. Real signal — nonfoil is
// where the base set value sits, foil where the premium hides.

interface Props {
  split: FinishSplit;
}

export default function FinishSplitPanel({ split }: Props) {
  const total = split.nonfoilTotal + split.foilTotal;
  if (total === 0) return null;
  const nonfoilPct = split.nonfoilTotal / total;
  const foilPct = split.foilTotal / total;

  return (
    <div className="lc-panel">
      <div className="label-mono">Finish value split</div>
      <div style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: '1fr 1fr',
        marginTop: 10,
      }}>
        <FinishTile
          label="Nonfoil"
          total={split.nonfoilTotal}
          count={split.nonfoilCount}
          coverage={split.nonfoilCoverage}
          color="var(--text-strong)"
        />
        <FinishTile
          label="Foil"
          total={split.foilTotal}
          count={split.foilCount}
          coverage={split.foilCoverage}
          color="var(--amethyst-500)"
        />
      </div>

      <div style={{
        display: 'flex',
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        marginTop: 14,
        border: '1px solid var(--border-light)',
        background: 'var(--surface-inset)',
      }} role="img" aria-label={`Nonfoil ${(nonfoilPct*100).toFixed(0)}%, foil ${(foilPct*100).toFixed(0)}%`}>
        <span style={{
          width: `${nonfoilPct * 100}%`,
          background: 'linear-gradient(90deg, #B0A38A, var(--gold-300))',
        }} />
        <span style={{
          width: `${foilPct * 100}%`,
          background: 'linear-gradient(90deg, var(--amethyst-400), var(--amethyst-600))',
        }} />
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 11.5, color: 'var(--text-muted)' }}>
        Sum of cheapest current USD retail per foil / nonfoil printing.
        Cards with no priced quote are excluded from both buckets.
      </p>
    </div>
  );
}

function FinishTile({ label, total, count, coverage, color }: {
  label: string;
  total: number;
  count: number;
  coverage: number;
  color: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'Outfit, monospace', fontWeight: 800, fontSize: 'var(--step-3)', color, marginTop: 4 }}>
        {formatUsd(total)}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
        {count} printings priced · {(coverage * 100).toFixed(0)}% covered
      </div>
    </div>
  );
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}
