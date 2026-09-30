import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { LC_INKS, LC_INK_LABEL } from '@/lib/lorcana/ink';
import { LC_CARD_TYPES, LC_CARD_TYPE_LABEL } from '@/lib/lorcana/card-type';
import { findCards, type FindFilters } from '@/server/find';
import CardBoard from '@/components/home/CardBoard';
import Faq from '@/components/Faq';
import { CARD_FINDER_FAQ } from '@/lib/faq-content';
import { getLorcanaCurrency } from '@/lib/currency-server';
import { CURRENCY_SOURCE_NAME, CURRENCY_SYMBOL } from '@/lib/currency';

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
  searchParams: Promise<Partial<Record<keyof FindFilters | 'priceMin' | 'priceMax', string>>>;
}

function parsePriceParam(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export default async function CardFinderPage({ searchParams }: Props) {
  const raw = await searchParams;
  const currency = await getLorcanaCurrency();
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
    priceMin: parsePriceParam(raw.priceMin),
    priceMax: parsePriceParam(raw.priceMax),
  };

  // Default-to-all: never gate on "user must pick a filter first".
  // Every visit renders the full priced catalogue and filters narrow.
  const anyFilter = Object.entries(filters).some(([k, v]) => k !== 'sort' && v != null && v !== '');
  const result = await findCards(filters, currency);

  return (
    <div className="lc-container lc-section">
      <header className="lc-page-hero" style={{ marginBottom: 24 }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div className="label-mono">Card Finder</div>
          <h1 style={{ margin: '4px 0 6px' }}>
            Find any Lorcana card
          </h1>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, maxWidth: 640, lineHeight: 1.55 }}>
            The full catalogue is here. Combine ink, rarity, card type
            and inkability to narrow it — or just search by name. Results
            ranked by highest current {CURRENCY_SOURCE_NAME[currency]} retail
            ({currency}) by default. Toggle currency in the header to swap
            the ranking market.
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
          <Field label={`Min price (${CURRENCY_SYMBOL[currency]})`}>
            <input
              name="priceMin"
              type="number"
              min={0}
              step="0.01"
              defaultValue={filters.priceMin ?? ''}
              placeholder="0"
              className="lc-input"
            />
          </Field>
          <Field label={`Max price (${CURRENCY_SYMBOL[currency]})`}>
            <input
              name="priceMax"
              type="number"
              min={0}
              step="0.01"
              defaultValue={filters.priceMax ?? ''}
              placeholder="Any"
              className="lc-input"
            />
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

      {/* Active-filter chips + quick presets */}
      {anyFilter && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {filters.ink && (
            <span className="chip chip-ink" style={{ fontSize: 12 }}>Ink: {filters.ink}</span>
          )}
          {filters.rarity && <span className="chip chip-gold" style={{ fontSize: 12 }}>Rarity: {filters.rarity}</span>}
          {filters.cardType && <span className="chip" style={{ fontSize: 12 }}>Type: {filters.cardType}</span>}
          {filters.inkable && <span className="chip" style={{ fontSize: 12 }}>{filters.inkable === 'true' ? 'Inkable' : 'Uninkable'}</span>}
          {filters.set && <span className="chip" style={{ fontSize: 12 }}>Set: {filters.set.toUpperCase()}</span>}
          {filters.q && <span className="chip" style={{ fontSize: 12 }}>"{filters.q}"</span>}
          {filters.priceMin != null && (
            <span className="chip" style={{ fontSize: 12 }}>
              Min: {CURRENCY_SYMBOL[currency]}{filters.priceMin}
            </span>
          )}
          {filters.priceMax != null && (
            <span className="chip" style={{ fontSize: 12 }}>
              Max: {CURRENCY_SYMBOL[currency]}{filters.priceMax}
            </span>
          )}
        </div>
      )}

      {result.tiles.length === 0 ? (
        <div className="lc-panel" style={{
          textAlign: 'center', color: 'var(--text-muted)',
          borderStyle: 'dashed', borderColor: 'var(--border-strong)',
        }}>
          No priced cards matched. Try loosening a filter or clearing the search.
        </div>
      ) : (
        <CardBoard tiles={result.tiles} columns={6} compact />
      )}

      {/* Preset shortcuts always available — collectors landing cold
          can still pivot to a common view. */}
      <div style={{ marginTop: 22, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Link href="/card-finder?rarity=Enchanted" className="chip chip-btn">Enchanted only</Link>
        <Link href="/card-finder?rarity=Iconic" className="chip chip-btn">Iconic only</Link>
        <Link href="/card-finder?cardType=LOCATION" className="chip chip-btn">Locations</Link>
        <Link href="/card-finder?inkable=false" className="chip chip-btn">Uninkable</Link>
        <Link href="/card-finder?ink=amethyst&rarity=Legendary" className="chip chip-btn">Amethyst Legendary</Link>
      </div>

      <Faq title="Using the Card Finder" entries={CARD_FINDER_FAQ} />
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
