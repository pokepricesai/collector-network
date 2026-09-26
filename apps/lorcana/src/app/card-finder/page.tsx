import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { LC_INKS, LC_INK_LABEL } from '@/lib/lorcana/ink';
import { LC_CARD_TYPES, LC_CARD_TYPE_LABEL } from '@/lib/lorcana/card-type';
import { findCards, type FindFilters } from '@/server/find';
import CardBoard from '@/components/home/CardBoard';

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Lorcana card finder — filter by ink, rarity, type and inkability',
  description:
    'Find any Disney Lorcana card by ink, rarity, card type, inkability and name. Results ranked by cheapest current USD retail across every printing.',
  alternates: { canonical: canonicalFor('/card-finder') },
};

const RARITY_OPTIONS = [
  'Common', 'Uncommon', 'Rare', 'Super rare',
  'Legendary', 'Epic', 'Iconic', 'Enchanted', 'Promo',
] as const;

interface Props {
  searchParams: Promise<Partial<Record<keyof FindFilters, string>>>;
}

export default async function CardFinderPage({ searchParams }: Props) {
  const raw = await searchParams;
  const filters: FindFilters = {
    ink: raw.ink ?? null,
    rarity: raw.rarity ?? null,
    cardType: raw.cardType ?? null,
    inkable: (raw.inkable === 'true' || raw.inkable === 'false')
      ? (raw.inkable as 'true' | 'false')
      : null,
    set: raw.set ?? null,
    q: raw.q ?? null,
    sort: (raw.sort as FindFilters['sort']) ?? 'price-desc',
  };

  const anyFilter = Object.entries(filters).some(([k, v]) => k !== 'sort' && v != null && v !== '');
  const result = anyFilter ? await findCards(filters) : null;

  return (
    <div className="lc-container lc-section">
      <header className="lc-page-hero" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">Card Finder</div>
          <h1 style={{ margin: '4px 0 6px' }}>
            Filter every Lorcana card
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, maxWidth: 640, lineHeight: 1.55 }}>
            Combine ink, rarity, card type and inkability. Results ranked
            by cheapest current USD retail across every printing.
          </p>
        </div>
      </header>

      <form method="get" action="/card-finder" style={{ display: 'grid', gap: 14, marginBottom: 24 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))' }}>
          <Field label="Name">
            <input
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder="e.g. Elsa"
              className="lc-input"
            />
          </Field>
          <Field label="Ink">
            <select name="ink" defaultValue={filters.ink ?? ''} className="lc-input">
              <option value="">Any ink</option>
              {LC_INKS.map((i) => (
                <option key={i} value={i}>{LC_INK_LABEL[i]}</option>
              ))}
            </select>
          </Field>
          <Field label="Rarity">
            <select name="rarity" defaultValue={filters.rarity ?? ''} className="lc-input">
              <option value="">Any rarity</option>
              {RARITY_OPTIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="Card type">
            <select name="cardType" defaultValue={filters.cardType ?? ''} className="lc-input">
              <option value="">Any type</option>
              {LC_CARD_TYPES.map((t) => (
                <option key={t} value={t}>{LC_CARD_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </Field>
          <Field label="Inkable">
            <select name="inkable" defaultValue={filters.inkable ?? ''} className="lc-input">
              <option value="">Either</option>
              <option value="true">Inkable</option>
              <option value="false">Uninkable</option>
            </select>
          </Field>
          <Field label="Sort by">
            <select name="sort" defaultValue={filters.sort ?? 'price-desc'} className="lc-input">
              <option value="price-desc">Price — high to low</option>
              <option value="price-asc">Price — low to high</option>
              <option value="name-asc">Name (A–Z)</option>
            </select>
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="submit" className="btn btn-primary btn-sm">Apply filters</button>
          <Link href="/card-finder" className="btn btn-ghost btn-sm">Clear all</Link>
          {result && (
            <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {result.tiles.length} priced result{result.tiles.length === 1 ? '' : 's'}
              {result.truncated && ' · showing first 400 candidates'}
            </span>
          )}
        </div>
      </form>

      {result ? (
        result.tiles.length === 0 ? (
          <div className="lc-panel" style={{
            textAlign: 'center', color: 'var(--text-muted)',
            borderStyle: 'dashed', borderColor: 'var(--border-strong)',
          }}>
            No priced cards matched. Try loosening a filter or clearing the search.
          </div>
        ) : (
          <CardBoard tiles={result.tiles} columns={6} compact />
        )
      ) : (
        <div className="lc-panel">
          <div className="label-mono" style={{ marginBottom: 8 }}>Start narrow</div>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.55 }}>
            Choose at least one filter above — ink, rarity, card type,
            inkability or a name query. Results appear priced and ranked
            by their cheapest current USD retail.
          </p>
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/card-finder?rarity=Enchanted" className="chip chip-btn">Enchanted only</Link>
            <Link href="/card-finder?rarity=Iconic" className="chip chip-btn">Iconic only</Link>
            <Link href="/card-finder?cardType=LOCATION" className="chip chip-btn">Locations</Link>
            <Link href="/card-finder?inkable=false" className="chip chip-btn">Uninkable</Link>
            <Link href="/card-finder?ink=amethyst&rarity=Legendary" className="chip chip-btn">Amethyst Legendary</Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span className="label-mono">{label}</span>
      {children}
    </label>
  );
}
