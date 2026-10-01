'use client';

// BrowseControls — compact search + sort + optional filter bar that
// drives any grid of tiles (characters index, set index, character
// detail). The parent passes an array of tiles enriched with a
// `search` haystack string and whatever filter metadata applies, plus
// a `sort` option enum, and this component maintains the filtered /
// sorted projection and exposes it via a render prop.
//
// Everything is client-only. The initial grid HTML is already rendered
// by the server component (so SEO / signed-out crawl value stays
// intact); this component only hides tiles that don't match the live
// query. Sorting mutates visible order via index assignment.

import { useMemo, useState, type ReactNode } from 'react';

export interface BrowseTile<TFilters extends Record<string, unknown>> {
  key: string;
  /** Lower-cased search haystack. */
  search: string;
  /** Opaque per-tile filter facets consumed by `filterFn`. */
  filters: TFilters;
  /** Sort keys consumed by `compareFn` and the per-sort direction map. */
  sortKeys: Record<string, number | string | null>;
}

export interface FilterSpec<K extends string> {
  key: K;
  label: string;
  options: { value: string; label: string }[];
}

export interface SortSpec {
  value: string;
  label: string;
}

interface Props<TFilters extends Record<string, string | null>> {
  tiles: BrowseTile<TFilters>[];
  sortOptions: SortSpec[];
  defaultSort: string;
  compareFn: (
    aKeys: BrowseTile<TFilters>['sortKeys'],
    bKeys: BrowseTile<TFilters>['sortKeys'],
    sort: string,
  ) => number;
  filterSpecs?: FilterSpec<keyof TFilters & string>[];
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Called with the ordered visible tile keys. */
  children: (
    visible: BrowseTile<TFilters>[],
    counts: { total: number; shown: number },
  ) => ReactNode;
}

export default function BrowseControls<
  TFilters extends Record<string, string | null>,
>(props: Props<TFilters>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(props.defaultSort);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let out = props.tiles;
    if (needle) {
      out = out.filter((t) => t.search.includes(needle));
    }
    const activeFilters = Object.entries(filters).filter(([, v]) => v);
    if (activeFilters.length > 0) {
      out = out.filter((t) =>
        activeFilters.every(([k, v]) => {
          const got = t.filters[k];
          return got === v;
        }),
      );
    }
    out = [...out].sort((a, b) => props.compareFn(a.sortKeys, b.sortKeys, sort));
    return out;
  }, [props, query, sort, filters]);

  const specs = props.filterSpecs ?? [];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={props.searchPlaceholder ?? 'Search…'}
          aria-label={props.searchPlaceholder ?? 'Search'}
          style={{
            flex: '1 1 220px',
            minWidth: 160,
            padding: '9px 12px',
            borderRadius: 10,
            border: '1px solid var(--border-strong, var(--border))',
            background: 'var(--bg-light)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort"
          style={{
            padding: '9px 10px',
            borderRadius: 10,
            border: '1px solid var(--border-strong, var(--border))',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: 13,
          }}
        >
          {props.sortOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {specs.map((spec) => (
          <select
            key={spec.key}
            value={filters[spec.key] ?? ''}
            onChange={(e) =>
              setFilters((f) => ({ ...f, [spec.key]: e.target.value }))
            }
            aria-label={spec.label}
            style={{
              padding: '9px 10px',
              borderRadius: 10,
              border: '1px solid var(--border-strong, var(--border))',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontFamily: 'inherit',
              fontSize: 13,
            }}
          >
            <option value="">{spec.label}: any</option>
            {spec.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {(query || sort !== props.defaultSort || Object.values(filters).some(Boolean)) && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSort(props.defaultSort);
              setFilters({});
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontFamily: 'inherit',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Showing {visible.length} of {props.tiles.length}
        {visible.length === 0 && props.emptyLabel ? ` — ${props.emptyLabel}` : ''}
      </div>
      {props.children(visible, { total: props.tiles.length, shown: visible.length })}
    </div>
  );
}
