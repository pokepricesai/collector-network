'use client';

// Client-side filter + sort on top of the set-page card grid.
// Keeps the JSON payload small: server sends one row per unique
// name (the "hero" card) with rarity, colour set and treatment-
// count metadata. The client filters and re-orders in-memory.

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { OP_COLOUR_LABEL, type OpColour } from '@/lib/onepiece/colour';

export interface SetGridEntry {
  name: string;
  href: string;
  collectorNumber: string | null;
  rarityLabel: string;
  rarityKey: string;
  treatmentCount: number;
  colours: OpColour[];
  imageUrl: string | null;
  priceUsd: number | null;
}

interface Props {
  entries: SetGridEntry[];
}

type Sort = 'default' | 'name-asc' | 'name-desc' | 'price-desc' | 'price-asc';

const COLOUR_OPTIONS: OpColour[] = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

export function SetGridClient({ entries }: Props) {
  const [rarity, setRarity] = useState<string>('all');
  const [colour, setColour] = useState<'all' | OpColour>('all');
  const [treatment, setTreatment] = useState<'all' | 'multi' | 'single'>('all');
  const [sort, setSort] = useState<Sort>('default');

  const rarities = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.rarityLabel) set.add(e.rarityLabel);
    return [...set].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let list = entries;
    if (rarity !== 'all') list = list.filter((e) => e.rarityLabel === rarity);
    if (colour !== 'all') list = list.filter((e) => e.colours.includes(colour));
    if (treatment === 'multi') list = list.filter((e) => e.treatmentCount > 1);
    else if (treatment === 'single') list = list.filter((e) => e.treatmentCount === 1);
    switch (sort) {
      case 'name-asc':
        list = [...list].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name-desc':
        list = [...list].sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'price-desc':
        list = [...list].sort((a, b) => (b.priceUsd ?? -Infinity) - (a.priceUsd ?? -Infinity));
        break;
      case 'price-asc':
        list = [...list].sort((a, b) => (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity));
        break;
      default:
        break;
    }
    return list;
  }, [entries, rarity, colour, treatment, sort]);

  return (
    <div>
      <div
        role="group"
        aria-label="Filters"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 16,
          padding: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
        }}
      >
        <FilterSelect label="Rarity" value={rarity} onChange={setRarity}>
          <option value="all">All</option>
          {rarities.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Colour"
          value={colour}
          onChange={(v) => setColour(v as 'all' | OpColour)}
        >
          <option value="all">All</option>
          {COLOUR_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {OP_COLOUR_LABEL[c]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect
          label="Treatments"
          value={treatment}
          onChange={(v) => setTreatment(v as 'all' | 'multi' | 'single')}
        >
          <option value="all">All</option>
          <option value="multi">Multiple (parallels / SEC / SPC / TR)</option>
          <option value="single">Single treatment</option>
        </FilterSelect>
        <FilterSelect label="Sort" value={sort} onChange={(v) => setSort(v as Sort)}>
          <option value="default">Collector number</option>
          <option value="name-asc">Name (A-Z)</option>
          <option value="name-desc">Name (Z-A)</option>
          <option value="price-desc">Price (high to low)</option>
          <option value="price-asc">Price (low to high)</option>
        </FilterSelect>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} / {entries.length} shown
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(min(160px, 100%), 1fr))',
          gap: 14,
        }}
      >
        {filtered.map((e) => (
          <Link
            key={e.href}
            href={e.href}
            className="card-hover card-hover-gold"
            style={{
              display: 'grid',
              gap: 8,
              padding: 12,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              textDecoration: 'none',
              color: 'var(--text)',
            }}
          >
            <div
              style={{
                position: 'relative',
                aspectRatio: '5 / 7',
                background: 'var(--bg-light)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {e.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={e.imageUrl}
                  alt={e.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
            </div>
            <div className="op-colour-rail" aria-hidden style={{ marginTop: 2 }}>
              {COLOUR_OPTIONS.map((hue) => (
                <span
                  key={hue}
                  data-hue={hue}
                  data-present={e.colours.includes(hue) ? 'true' : 'false'}
                />
              ))}
            </div>
            <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.25 }}>{e.name}</div>
            <div className="label-mono" style={{ color: 'var(--text-muted)' }}>
              {e.collectorNumber ?? '—'} · {e.rarityLabel}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              {e.treatmentCount > 1 && (
                <span
                  className="chip chip-gold"
                  style={{ width: 'fit-content' }}
                  title="Multiple treatments — parallel, secret rare, special card, treasure rare, promo or reprint"
                >
                  +{e.treatmentCount - 1} treatments
                </span>
              )}
              {e.priceUsd != null && (
                <span style={{ marginLeft: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 13, fontWeight: 700 }}>
                  ${e.priceUsd.toFixed(2)}
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, minWidth: 140 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '7px 10px',
          borderRadius: 8,
          border: '1px solid var(--border-strong, var(--border))',
          background: 'var(--bg-light)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        {children}
      </select>
    </label>
  );
}
