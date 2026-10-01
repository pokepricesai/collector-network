'use client';

// Interactive grid of versions for a single character. Server passes
// pre-enriched tile data; this component maintains search + filter +
// sort state and renders the same tile layout the server component
// used before. The completion module above the grid is NOT affected
// by filters — denominator is always the full set, matching the
// established per-character completion semantics.

import Link from 'next/link';
import BrowseControls, {
  type BrowseTile,
  type FilterSpec,
  type SortSpec,
} from '../browse/BrowseControls';
import CharacterTileAdd, {
  type CharacterTilePrinting,
} from './CharacterTileAdd';
import { formatPrice, type LorcanaCurrency } from '../../lib/currency';

export interface CharacterVersionTileData {
  cardId: string;
  cardName: string;
  cardSlug: string;
  subtitle: string | null;
  setCode: string | null;
  setName: string | null;
  releasedAt: string | null;
  collectorNumber: string | null;
  rarity: string | null;
  ink: string | null;
  image: string | null;
  isOwned: boolean;
  price: number | null;
  priceSourceLabel: string;
  printings: CharacterTilePrinting[];
}

interface Props {
  tiles: CharacterVersionTileData[];
  currency: LorcanaCurrency;
  isSignedIn: boolean;
  returnPath: string;
  availableSets: Array<{ value: string; label: string }>;
  availableInks: Array<{ value: string; label: string }>;
  availableRarities: Array<{ value: string; label: string }>;
}

type Filters = Record<string, string | null>;

function collectorNumberKey(cn: string | null | undefined): number {
  if (!cn) return 1_000_000;
  const m = /^(\d+)/.exec(cn);
  return m ? Number(m[1]) : 1_000_000;
}

export default function CharacterVersionsGrid(props: Props) {
  const browseTiles: BrowseTile<Filters>[] = props.tiles.map((t) => ({
    key: t.cardId,
    search: [
      t.cardName,
      t.subtitle,
      t.setCode,
      t.setName,
      t.collectorNumber,
      t.rarity,
      t.ink,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
    filters: {
      set: t.setCode ?? null,
      ink: t.ink ?? null,
      rarity: t.rarity ?? null,
      owned: t.isOwned ? '__owned__' : '__missing__',
      has_price: t.price != null ? '__has_price__' : null,
    } as Filters,
    sortKeys: {
      name: t.cardName.toLowerCase(),
      cn: collectorNumberKey(t.collectorNumber),
      price: t.price ?? null,
      released: t.releasedAt ?? '',
      ownedFlag: t.isOwned ? 1 : 0,
    },
  }));

  const sortOptions: SortSpec[] = [
    { value: 'cn-asc', label: 'Collector number' },
    { value: 'name-asc', label: 'Name A → Z' },
    { value: 'name-desc', label: 'Name Z → A' },
    { value: 'price-desc', label: 'Price high → low' },
    { value: 'price-asc', label: 'Price low → high' },
    { value: 'released-desc', label: 'Newest set' },
    { value: 'released-asc', label: 'Oldest set' },
    ...(props.isSignedIn
      ? [
          { value: 'missing-first', label: 'Missing first' },
          { value: 'owned-first', label: 'Owned first' },
        ]
      : []),
  ];

  const filterSpecs: FilterSpec<string>[] = [
    { key: 'set', label: 'Set', options: props.availableSets },
    { key: 'ink', label: 'Ink', options: props.availableInks },
    { key: 'rarity', label: 'Rarity', options: props.availableRarities },
    {
      key: 'has_price',
      label: 'Pricing',
      options: [{ value: '__has_price__', label: 'Has current price' }],
    },
    ...(props.isSignedIn
      ? [
          {
            key: 'owned',
            label: 'Ownership',
            options: [
              { value: '__owned__', label: 'Owned' },
              { value: '__missing__', label: 'Missing' },
            ],
          },
        ]
      : []),
  ];

  const compareFn = (
    a: BrowseTile<Filters>['sortKeys'],
    b: BrowseTile<Filters>['sortKeys'],
    sort: string,
  ) => {
    const cmpName = () => String(a.name).localeCompare(String(b.name));
    switch (sort) {
      case 'name-asc':
        return cmpName();
      case 'name-desc':
        return -cmpName();
      case 'cn-asc':
        return Number(a.cn) - Number(b.cn) || cmpName();
      case 'price-desc': {
        const ap = a.price;
        const bp = b.price;
        if (ap == null && bp == null) return cmpName();
        if (ap == null) return 1;
        if (bp == null) return -1;
        return Number(bp) - Number(ap) || cmpName();
      }
      case 'price-asc': {
        const ap = a.price;
        const bp = b.price;
        if (ap == null && bp == null) return cmpName();
        if (ap == null) return 1;
        if (bp == null) return -1;
        return Number(ap) - Number(bp) || cmpName();
      }
      case 'released-desc':
        return String(b.released).localeCompare(String(a.released)) || cmpName();
      case 'released-asc':
        return String(a.released).localeCompare(String(b.released)) || cmpName();
      case 'owned-first':
        return Number(b.ownedFlag) - Number(a.ownedFlag) || cmpName();
      case 'missing-first':
        return Number(a.ownedFlag) - Number(b.ownedFlag) || cmpName();
      default:
        return 0;
    }
  };

  const byKey = new Map(props.tiles.map((t) => [t.cardId, t]));

  return (
    <BrowseControls<Filters>
      tiles={browseTiles}
      sortOptions={sortOptions}
      defaultSort="cn-asc"
      compareFn={compareFn}
      filterSpecs={filterSpecs}
      searchPlaceholder="Search name, subtitle, set, number"
      emptyLabel="no versions match"
    >
      {(visible) => (
        <div
          id="missing"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
          }}
        >
          {visible.map((row) => {
            const v = byKey.get(row.key);
            if (!v) return null;
            return (
              <div
                key={v.cardId}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 14,
                  borderRadius: 12,
                  border: `1px solid ${v.isOwned ? 'var(--primary, #6A43BE)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  position: 'relative',
                  minWidth: 0,
                  gap: 10,
                }}
              >
                {v.isOwned && props.isSignedIn && (
                  <span
                    aria-label="Owned"
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      padding: '2px 8px',
                      borderRadius: 999,
                      background: 'var(--primary, #6A43BE)',
                      color: '#fff',
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      zIndex: 1,
                    }}
                  >
                    OWNED
                  </span>
                )}
                <Link
                  href={`/card/${v.cardSlug}`}
                  style={{
                    color: 'var(--text)',
                    textDecoration: 'none',
                    display: 'block',
                  }}
                >
                  {v.image && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={v.image}
                      alt={v.cardName}
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
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {v.subtitle ? v.subtitle : v.cardName}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    {v.setCode?.toUpperCase() ?? ''} {v.collectorNumber ?? ''}
                    {v.rarity ? ` · ${v.rarity}` : ''}
                    {v.ink ? ` · ${v.ink}` : ''}
                  </div>
                </Link>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginTop: 'auto',
                  }}
                >
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: v.price == null ? 12 : 15,
                      color: v.price == null ? 'var(--text-muted)' : 'var(--text-strong)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {formatPrice(v.price, props.currency)}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--text-subtle, var(--text-muted))' }}>
                    {v.priceSourceLabel}
                  </div>
                </div>
                <CharacterTileAdd
                  cardId={v.cardId}
                  cardName={v.cardName}
                  isSignedIn={props.isSignedIn}
                  returnPath={props.returnPath}
                  printings={v.printings}
                  isOwned={v.isOwned}
                />
              </div>
            );
          })}
        </div>
      )}
    </BrowseControls>
  );
}
