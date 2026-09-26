import Link from 'next/link';

// Chase-count summary strip for a set. The audit shows that Sets 9+
// introduced Iconic (2/set) and Epic (18/set); earlier sets carry only
// Enchanted + Legendary. Show only the tiers actually present.

interface Props {
  counts: Record<string, number>;
  setCode: string;
}

const CHASE_TIERS: Array<{ rarity: string; label: string; badgeClass: string }> = [
  { rarity: 'Enchanted', label: 'Enchanted', badgeClass: 'treatment-badge--enchanted' },
  { rarity: 'Iconic',    label: 'Iconic',    badgeClass: 'treatment-badge--iconic' },
  { rarity: 'Epic',      label: 'Epic',      badgeClass: 'treatment-badge--epic' },
  { rarity: 'Legendary', label: 'Legendary', badgeClass: 'treatment-badge--legendary' },
  { rarity: 'Promo',     label: 'Promo',     badgeClass: 'treatment-badge--promo' },
];

export default function ChaseCounts({ counts, setCode }: Props) {
  const present = CHASE_TIERS.filter((t) => (counts[t.rarity] ?? 0) > 0);
  if (present.length === 0) return null;
  return (
    <div className="lc-panel">
      <div className="label-mono" style={{ marginBottom: 10 }}>Chase in this set</div>
      <div style={{
        display: 'grid',
        gap: 10,
        gridTemplateColumns: `repeat(${Math.min(present.length, 5)}, minmax(0, 1fr))`,
      }}>
        {present.map((t) => (
          <Link
            key={t.rarity}
            href={`/set/${encodeURIComponent(setCode.toLowerCase())}?rarity=${encodeURIComponent(t.rarity)}`}
            className="lc-hover"
            style={{
              padding: 10,
              background: 'var(--surface-inset)',
              border: '1px solid var(--border-light)',
              borderRadius: 10,
              display: 'grid',
              gap: 4,
              justifyItems: 'start',
              textDecoration: 'none',
              color: 'var(--text)',
            }}
          >
            <span className={`treatment-badge ${t.badgeClass}`}>{t.label}</span>
            <span style={{ fontFamily: 'Outfit, monospace', fontWeight: 800, fontSize: 22, color: 'var(--text-strong)' }}>
              {counts[t.rarity]}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
