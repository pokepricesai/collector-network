'use client';

// Client-rendered grid of character tiles. The server supplies every
// entry pre-enriched with ownedCount so this component only handles
// search/sort/filter interactivity.

import Link from 'next/link';
import BrowseControls, {
  type BrowseTile,
  type SortSpec,
} from '../browse/BrowseControls';

export interface CharacterTileData {
  slug: string;
  name: string;
  cardCount: number;
  ownedCount: number; // 0 when signed out
  ink: string | null;
  representativeImage: string | null;
}

interface Props {
  entries: CharacterTileData[];
  isSignedIn: boolean;
}

type Filters = Record<string, string | null>;

export default function CharactersGrid({ entries, isSignedIn }: Props) {
  const tiles: BrowseTile<Filters>[] = entries.map((c) => {
    const pct = c.cardCount > 0 ? c.ownedCount / c.cardCount : 0;
    return {
      key: c.slug,
      search: `${c.name.toLowerCase()} ${c.ink?.toLowerCase() ?? ''}`,
      filters: {} as Filters,
      sortKeys: {
        name: c.name.toLowerCase(),
        cards: c.cardCount,
        owned: c.ownedCount,
        missing: c.cardCount - c.ownedCount,
        completionPct: pct,
      },
    };
  });

  const sortOptions: SortSpec[] = [
    { value: 'name-asc', label: 'A → Z' },
    { value: 'name-desc', label: 'Z → A' },
    { value: 'cards-desc', label: 'Most cards' },
    { value: 'cards-asc', label: 'Fewest cards' },
    ...(isSignedIn
      ? [
          { value: 'completion-desc', label: 'Highest completion %' },
          { value: 'completion-asc', label: 'Lowest completion %' },
          { value: 'owned-desc', label: 'Most cards owned' },
          { value: 'missing-desc', label: 'Most cards missing' },
        ]
      : []),
  ];

  const compareFn = (a: BrowseTile<Filters>['sortKeys'], b: BrowseTile<Filters>['sortKeys'], sort: string) => {
    switch (sort) {
      case 'name-asc':
        return String(a.name).localeCompare(String(b.name));
      case 'name-desc':
        return String(b.name).localeCompare(String(a.name));
      case 'cards-desc':
        return Number(b.cards) - Number(a.cards) || String(a.name).localeCompare(String(b.name));
      case 'cards-asc':
        return Number(a.cards) - Number(b.cards) || String(a.name).localeCompare(String(b.name));
      case 'completion-desc':
        return Number(b.completionPct) - Number(a.completionPct) || String(a.name).localeCompare(String(b.name));
      case 'completion-asc':
        return Number(a.completionPct) - Number(b.completionPct) || String(a.name).localeCompare(String(b.name));
      case 'owned-desc':
        return Number(b.owned) - Number(a.owned) || String(a.name).localeCompare(String(b.name));
      case 'missing-desc':
        return Number(b.missing) - Number(a.missing) || String(a.name).localeCompare(String(b.name));
      default:
        return 0;
    }
  };

  const byKey = new Map(entries.map((e) => [e.slug, e]));

  return (
    <BrowseControls
      tiles={tiles}
      sortOptions={sortOptions}
      defaultSort="name-asc"
      compareFn={compareFn}
      searchPlaceholder="Search characters by name"
      emptyLabel="no characters match"
    >
      {(visible) => (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {visible.map((v) => {
            const c = byKey.get(v.key);
            if (!c) return null;
            const pct =
              c.cardCount > 0 ? Math.round((c.ownedCount / c.cardCount) * 100) : 0;
            return (
              <Link
                key={c.slug}
                href={`/character/${c.slug}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  textDecoration: 'none',
                }}
              >
                {c.representativeImage && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={c.representativeImage}
                    alt=""
                    loading="lazy"
                    style={{
                      width: '100%',
                      aspectRatio: '5 / 7',
                      objectFit: 'cover',
                      borderRadius: 8,
                      marginBottom: 10,
                      background: 'var(--bg-strong)',
                    }}
                  />
                )}
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 4 }}>
                  {c.cardCount} {c.cardCount === 1 ? 'card' : 'cards'}
                  {c.ink ? ` · ${c.ink}` : ''}
                </div>
                {isSignedIn ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {c.ownedCount} / {c.cardCount} collected · {pct}% complete
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
