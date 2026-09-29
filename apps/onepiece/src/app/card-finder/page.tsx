import type { Metadata } from 'next';
import Link from 'next/link';
import { canonicalFor } from '@/lib/seo';
import { OP_COLOURS, OP_COLOUR_LABEL, type OpColour, isOpColour } from '@/lib/onepiece/colour';
import { OP_CARD_TYPES, OP_CARD_TYPE_LABEL, type OpCardType, normaliseCardType } from '@/lib/onepiece/card-type';
import { queryFinder, type OpFinderFilters, type OpSort } from '@/server/finder';
import { formatPrice } from '@/lib/onepiece/currency';
import { getCurrencyPreference } from '@/lib/onepiece/currency-server';
import { listSetsWithCounts } from '@/server/browse';
import Faq from '@/components/Faq';
import { CARD_FINDER_FAQ } from '@/lib/faq-content';

// Real interactive Card Finder. Default view: all One Piece cards
// deduped by name, ranked A-Z. Filters narrow the catalogue; the
// URL fully encodes the state so any view is shareable.

export const revalidate = 900;
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'One Piece card finder. Filter every card by colour, type, cost, power and more',
  description:
    'Filter every ingested One Piece Card Game card by colour, card type, rarity, cost, power, counter, life, attribute, set and live price.',
  alternates: { canonical: canonicalFor('/card-finder') },
};

const PAGE_SIZE = 60;
const ATTRIBUTES = ['Slash', 'Strike', 'Ranged', 'Special', 'Wisdom'] as const;
const RARITIES = ['L', 'C', 'UC', 'R', 'SR', 'SEC', 'SP CARD', 'TR', 'P'] as const;
const SORTS: Array<{ value: OpSort; label: string }> = [
  { value: 'name',       label: 'Name (A-Z)' },
  { value: 'price-desc', label: 'Price ↓ (dearest first)' },
  { value: 'price-asc',  label: 'Price ↑ (cheapest first)' },
  { value: 'cost-asc',   label: 'Cost ↑' },
  { value: 'power-desc', label: 'Power ↓' },
  { value: 'set-newest', label: 'Set (newest)' },
];

export default async function CardFinderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const filters = readFilters(sp);
  const sort = readSort(sp);
  const page = Math.max(0, Number(sp['page'] ?? '0') || 0);

  const [sets, currency] = await Promise.all([
    listSetsWithCounts(),
    getCurrencyPreference(),
  ]);
  const setOptions = sets.map((s) => ({ id: s.set.id, code: s.set.code, name: s.set.name }));
  const result = await queryFinder(filters, sort, page, PAGE_SIZE, sets.map((s) => s.set), currency);

  const hasAnyFilter = filters.q != null || filters.colour != null || filters.cardType != null ||
    filters.rarity != null || filters.setId != null || filters.attribute != null ||
    filters.costMin != null || filters.costMax != null ||
    filters.powerMin != null || filters.powerMax != null ||
    filters.counterMin != null || filters.counterMax != null ||
    filters.lifeMin != null || filters.lifeMax != null ||
    filters.priceMin != null || filters.priceMax != null ||
    filters.onlyPriced === true;

  return (
    <div style={{ padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="op-page-hero" style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="label-mono" style={{ color: 'var(--gold-600)' }}>Card Finder</div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 30 }}>
              Filter every One Piece card
            </h1>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 15, maxWidth: 640, lineHeight: 1.55 }}>
              Colour, card type, rarity, gameplay stats and live retail price. Every
              filter is URL-driven. Copy the address bar to share a view.
            </p>
          </div>
        </header>

        <form method="get" style={filterFormStyle}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
            <Field label="Search by name">
              <input
                name="q"
                defaultValue={filters.q ?? ''}
                placeholder="Luffy, Boa Hancock…"
                style={inputStyle}
                autoComplete="off"
              />
            </Field>

            <Field label="Colour">
              <select name="colour" defaultValue={filters.colour ?? ''} style={inputStyle}>
                <option value="">Any colour</option>
                {OP_COLOURS.map((c) => (
                  <option key={c} value={c}>{OP_COLOUR_LABEL[c]}</option>
                ))}
                <option value="multi">Multi-colour</option>
              </select>
            </Field>

            <Field label="Card type">
              <select name="cardType" defaultValue={filters.cardType ?? ''} style={inputStyle}>
                <option value="">Any type</option>
                {OP_CARD_TYPES.map((t) => (
                  <option key={t} value={t}>{OP_CARD_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </Field>

            <Field label="Rarity">
              <select name="rarity" defaultValue={filters.rarity ?? ''} style={inputStyle}>
                <option value="">Any rarity</option>
                {RARITIES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </Field>

            <Field label="Set">
              <select name="setId" defaultValue={filters.setId ?? ''} style={inputStyle}>
                <option value="">Any set</option>
                {setOptions.map((s) => (
                  <option key={s.id} value={s.id}>{s.code.toUpperCase()}, {s.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Attribute">
              <select name="attribute" defaultValue={filters.attribute ?? ''} style={inputStyle}>
                <option value="">Any attribute</option>
                {ATTRIBUTES.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </Field>

            <RangeField label="Cost" min="costMin" max="costMax" valueMin={filters.costMin} valueMax={filters.costMax} minPh="0" maxPh="10" />
            <RangeField label="Power" min="powerMin" max="powerMax" valueMin={filters.powerMin} valueMax={filters.powerMax} minPh="0" maxPh="15000" />
            <RangeField label="Counter" min="counterMin" max="counterMax" valueMin={filters.counterMin} valueMax={filters.counterMax} minPh="0" maxPh="2000" />
            <RangeField label="Life" min="lifeMin" max="lifeMax" valueMin={filters.lifeMin} valueMax={filters.lifeMax} minPh="1" maxPh="5" />
            <RangeField label={`Price (${currency})`} min="priceMin" max="priceMax" valueMin={filters.priceMin} valueMax={filters.priceMax} minPh="0" maxPh="10000" />

            <Field label="Sort">
              <select name="sort" defaultValue={sort} style={inputStyle}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </Field>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                <input type="checkbox" name="onlyPriced" value="1" defaultChecked={filters.onlyPriced === true} style={{ accentColor: 'var(--gold-600)' }}/>
                Priced only
              </label>
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" style={primaryButtonStyle}>Apply filters</button>
            {hasAnyFilter && (
              <Link href="/card-finder" style={ghostButtonStyle}>Reset</Link>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)', alignSelf: 'center' }}>
              {result.total.toLocaleString()} card{result.total === 1 ? '' : 's'} match
              {hasAnyFilter ? ' your filters' : ''}
            </span>
          </div>
        </form>

        {result.tiles.length === 0 ? (
          <div style={emptyPanel}>
            No cards match this filter combination. Try broadening one axis (colour or set is usually the strongest narrowing).
          </div>
        ) : (
          <section
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))',
              gap: 14,
              marginTop: 24,
            }}
          >
            {result.tiles.map((tile) => (
              <article key={tile.cardId} style={tileStyle}>
                <Link href={tile.href} style={{ textDecoration: 'none', color: 'inherit', display: 'grid', gap: 8 }}>
                  <div style={imageWrapStyle}>
                    {tile.imageUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={tile.imageUrl}
                        alt={tile.name}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div style={imagePlaceholderStyle}>Art loading</div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>{tile.name}</div>
                    <div className="label-mono" style={{ fontSize: 10.5 }}>
                      {(tile.set?.code ?? '').toUpperCase() || '–'} · {tile.collectorNumber ?? '–'} · {tile.rarity ?? '–'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                      {tile.gamedata.colours.map((c) => (
                        <span key={c} className={`chip chip-${c}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                          {OP_COLOUR_LABEL[c]}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 2 }}>
                      <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700, fontSize: 14 }}>
                        {formatPrice(tile.price, tile.currency)}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
                        {tile.printingCount} printing{tile.printingCount === 1 ? '' : 's'}
                      </div>
                    </div>
                  </div>
                </Link>
              </article>
            ))}
          </section>
        )}

        <Paginator page={result.page} pageSize={result.pageSize} total={result.total} searchParams={sp} />

        <Faq title="Card Finder. What you can search" entries={CARD_FINDER_FAQ} />
      </div>
    </div>
  );
}

function readFilters(sp: Record<string, string | undefined>): OpFinderFilters {
  const q = sp['q']?.trim() || undefined;
  const colour = sp['colour']?.trim().toLowerCase();
  const rawCardType = normaliseCardType(sp['cardType']);
  const cardType = rawCardType ?? undefined;
  const rarity = sp['rarity']?.trim() || undefined;
  const setId = sp['setId']?.trim() || undefined;
  const attribute = sp['attribute']?.trim() || undefined;
  const onlyPriced = sp['onlyPriced'] === '1' || sp['onlyPriced'] === 'true';

  const num = (v: string | undefined) => {
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const filters: OpFinderFilters = {
    q,
    cardType,
    rarity,
    setId,
    attribute,
    costMin: num(sp['costMin']),
    costMax: num(sp['costMax']),
    powerMin: num(sp['powerMin']),
    powerMax: num(sp['powerMax']),
    counterMin: num(sp['counterMin']),
    counterMax: num(sp['counterMax']),
    lifeMin: num(sp['lifeMin']),
    lifeMax: num(sp['lifeMax']),
    priceMin: num(sp['priceMin']) ?? num(sp['priceMinEur']),
    priceMax: num(sp['priceMax']) ?? num(sp['priceMaxEur']),
    onlyPriced,
  };
  if (colour === 'multi') filters.colour = 'multi';
  else if (colour && (OP_COLOURS as readonly string[]).includes(colour)) {
    filters.colour = colour as OpColour;
  }
  return filters;
}

function readSort(sp: Record<string, string | undefined>): OpSort {
  const raw = sp['sort'];
  const allowed: OpSort[] = ['name', 'price-desc', 'price-asc', 'cost-asc', 'power-desc', 'set-newest'];
  if (raw && (allowed as string[]).includes(raw)) return raw as OpSort;
  return 'name';
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function RangeField({ label, min, max, valueMin, valueMax, minPh, maxPh }: {
  label: string;
  min: string;
  max: string;
  valueMin?: number;
  valueMax?: number;
  minPh: string;
  maxPh: string;
}) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span style={fieldLabelStyle}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          name={min}
          type="number"
          min="0"
          step="1"
          placeholder={minPh}
          defaultValue={valueMin ?? ''}
          style={{ ...inputStyle, width: '100%' }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>→</span>
        <input
          name={max}
          type="number"
          min="0"
          step="1"
          placeholder={maxPh}
          defaultValue={valueMax ?? ''}
          style={{ ...inputStyle, width: '100%' }}
        />
      </div>
    </div>
  );
}

function Paginator({ page, pageSize, total, searchParams }: {
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | undefined>;
}) {
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (lastPage === 0) return null;

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== '' && k !== 'page') params.set(k, v);
    }
    params.set('page', String(p));
    return `/card-finder?${params.toString()}`;
  }

  return (
    <nav aria-label="Pagination" style={{
      marginTop: 24,
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
    }}>
      {page > 0 && <Link href={pageHref(page - 1)} style={ghostButtonStyle}>← Prev</Link>}
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
        Page {page + 1} of {lastPage + 1}
      </span>
      {page < lastPage && <Link href={pageHref(page + 1)} style={ghostButtonStyle}>Next →</Link>}
    </nav>
  );
}

const filterFormStyle: React.CSSProperties = {
  padding: 16,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  marginBottom: 8,
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-strong, var(--border))',
  background: 'var(--bg-light)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
  width: '100%',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 10,
  background: 'var(--gold-600)',
  color: '#111',
  border: '1px solid var(--gold-600)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  borderRadius: 10,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border-strong, var(--border))',
  textDecoration: 'none',
  fontSize: 13,
  fontWeight: 600,
};

const emptyPanel: React.CSSProperties = {
  marginTop: 24,
  padding: 24,
  background: 'var(--surface)',
  border: '1px dashed var(--border-strong)',
  borderRadius: 14,
  color: 'var(--text-muted)',
  textAlign: 'center',
  fontSize: 14,
};

const tileStyle: React.CSSProperties = {
  padding: 10,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 12,
};

const imageWrapStyle: React.CSSProperties = {
  position: 'relative',
  aspectRatio: '5 / 7',
  background: 'var(--bg-light)',
  borderRadius: 8,
  overflow: 'hidden',
};

const imagePlaceholderStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-muted)',
  fontSize: 12,
};
