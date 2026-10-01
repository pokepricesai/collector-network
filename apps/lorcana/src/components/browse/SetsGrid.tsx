'use client';

// Client-rendered set index. Server supplies the enriched entries;
// this component owns search/sort/filter + renders tiles.

import Link from 'next/link';
import BrowseControls, {
  type BrowseTile,
  type SortSpec,
} from './BrowseControls';

export interface SetTileData {
  code: string;
  name: string;
  releasedAt: string | null;
  uniqueCardCount: number;
  variantCount: number;
  ownedCount: number;
}

interface Props {
  entries: SetTileData[];
  isSignedIn: boolean;
}

function formatReleased(iso: string | null): string {
  if (!iso) return 'TBA';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

type Filters = Record<string, string | null>;

export default function SetsGrid({ entries, isSignedIn }: Props) {
  const tiles: BrowseTile<Filters>[] = entries.map((s) => {
    const pct = s.uniqueCardCount > 0 ? s.ownedCount / s.uniqueCardCount : 0;
    return {
      key: s.code,
      search: `${s.name.toLowerCase()} ${s.code.toLowerCase()}`,
      filters: {} as Filters,
      sortKeys: {
        released: s.releasedAt ?? '',
        name: s.name.toLowerCase(),
        completionPct: pct,
        missing: s.uniqueCardCount - s.ownedCount,
      },
    };
  });

  const sortOptions: SortSpec[] = [
    { value: 'released-desc', label: 'Release date (newest)' },
    { value: 'released-asc', label: 'Release date (oldest)' },
    { value: 'name-asc', label: 'Name A → Z' },
    { value: 'name-desc', label: 'Name Z → A' },
    ...(isSignedIn
      ? [
          { value: 'completion-desc', label: 'Highest completion %' },
          { value: 'completion-asc', label: 'Lowest completion %' },
          { value: 'missing-desc', label: 'Most cards missing' },
        ]
      : []),
  ];

  const compareFn = (a: BrowseTile<Filters>['sortKeys'], b: BrowseTile<Filters>['sortKeys'], sort: string) => {
    const cmpName = () => String(a.name).localeCompare(String(b.name));
    switch (sort) {
      case 'released-desc':
        return String(b.released).localeCompare(String(a.released)) || cmpName();
      case 'released-asc':
        return String(a.released).localeCompare(String(b.released)) || cmpName();
      case 'name-asc':
        return cmpName();
      case 'name-desc':
        return -cmpName();
      case 'completion-desc':
        return Number(b.completionPct) - Number(a.completionPct) || cmpName();
      case 'completion-asc':
        return Number(a.completionPct) - Number(b.completionPct) || cmpName();
      case 'missing-desc':
        return Number(b.missing) - Number(a.missing) || cmpName();
      default:
        return 0;
    }
  };

  const byKey = new Map(entries.map((e) => [e.code, e]));

  return (
    <BrowseControls
      tiles={tiles}
      sortOptions={sortOptions}
      defaultSort="released-desc"
      compareFn={compareFn}
      searchPlaceholder="Search sets by name or code"
      emptyLabel="no sets match"
    >
      {(visible) => (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
            gap: 14,
          }}
        >
          {visible.map((row) => {
            const s = byKey.get(row.key);
            if (!s) return null;
            const pct =
              s.uniqueCardCount > 0 ? Math.round((s.ownedCount / s.uniqueCardCount) * 100) : 0;
            return (
              <Link
                key={s.code}
                href={`/set/${encodeURIComponent(s.code.toLowerCase())}`}
                className="lc-hover lc-hover-gold"
                style={{
                  display: 'grid',
                  gap: 10,
                  padding: 16,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  textDecoration: 'none',
                  color: 'var(--text)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span className="label-mono" style={{ color: 'var(--text-muted)' }}>
                    {s.code.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {formatReleased(s.releasedAt)}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 700,
                    fontSize: 16,
                    color: 'var(--text-strong)',
                    lineHeight: 1.25,
                  }}
                >
                  {s.name}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                  <span>
                    {s.uniqueCardCount} card{s.uniqueCardCount === 1 ? '' : 's'}
                  </span>
                  {s.variantCount > s.uniqueCardCount && (
                    <span style={{ color: 'var(--accent-2)', marginLeft: 8, fontWeight: 600 }}>
                      · +{s.variantCount - s.uniqueCardCount} treatments
                    </span>
                  )}
                </div>
                {isSignedIn ? (
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {s.ownedCount} / {s.uniqueCardCount} · {pct}% complete
                    </div>
                    <div
                      aria-hidden
                      style={{
                        marginTop: 6,
                        height: 6,
                        borderRadius: 999,
                        background: 'var(--bg-light, rgba(0,0,0,0.06))',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--primary, #6A43BE)',
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </BrowseControls>
  );
}
