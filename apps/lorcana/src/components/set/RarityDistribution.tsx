import type { RarityDistribution as Row } from '@/server/discovery';

// A horizontal segmented bar showing the rarity mix of a set, with a
// legend beneath. Reads at a glance ("mostly commons, 18 Enchanted,
// 12 Legendary") without forcing the reader into a table.

interface Props {
  rows: Row[];
  totalCards: number;
}

export default function RarityDistribution({ rows, totalCards }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="lc-panel">
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <div>
          <div className="label-mono">Rarity mix</div>
          <div className="metric-sm metric" style={{ marginTop: 2 }}>
            {totalCards} cards
          </div>
        </div>
      </div>

      <div className="lc-rarity-bar" role="img" aria-label={`Rarity distribution across ${totalCards} cards`}>
        {rows.map((r) => (
          <span
            key={r.rarity}
            data-rarity={r.rarity}
            style={{ width: `${(r.pct * 100).toFixed(2)}%` }}
            title={`${r.rarity}: ${r.count} (${(r.pct * 100).toFixed(1)}%)`}
          />
        ))}
      </div>

      <ul style={{
        listStyle: 'none',
        padding: 0,
        margin: '14px 0 0',
        display: 'grid',
        gap: 6,
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(140px, 100%), 1fr))',
      }}>
        {rows.map((r) => (
          <li key={r.rarity} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span aria-hidden style={{
              width: 10, height: 10, borderRadius: 2, flexShrink: 0,
              background: swatchFor(r.rarity),
            }} />
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>{r.rarity}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', color: 'var(--text-muted)' }}>
              {r.count}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function swatchFor(rarity: string): string {
  switch (rarity) {
    case 'Common':     return '#B0A38A';
    case 'Uncommon':   return '#7D8AA0';
    case 'Rare':       return 'var(--sapphire-400)';
    case 'Super rare': return 'var(--sapphire-500)';
    case 'Legendary':  return 'var(--gold-400)';
    case 'Epic':       return 'var(--ink-ruby)';
    case 'Iconic':     return 'linear-gradient(90deg, var(--gold-400), var(--amethyst-400))';
    case 'Enchanted':  return 'var(--amethyst-400)';
    case 'Promo':      return 'var(--green)';
    default:           return 'var(--text-subtle)';
  }
}
