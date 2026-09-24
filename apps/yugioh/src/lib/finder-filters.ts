// Card Finder filter shape + URL (de)serialisation. Kept pure so
// server, client and tests share one canonical representation.
//
// One filter = one URL parameter. Empty / undefined fields are
// omitted from the URL entirely so `?attribute=LIGHT` stays clean
// and the base `/card-finder` route serialises to itself.

export type BanlistState = 'forbidden' | 'limited' | 'semi_limited' | 'unlimited';

export type FinderSort =
  | 'relevance'
  | 'name-asc'
  | 'name-desc'
  | 'price-asc'
  | 'price-desc'
  | 'atk-desc'
  | 'atk-asc'
  | 'def-desc'
  | 'newest'
  | 'oldest';

export interface FinderFilters {
  // Free-text query (name and effect text ILIKE match).
  q: string;

  // Structured filters — undefined means "no filter".
  attribute?: string;         // LIGHT / DARK / …
  frameType?: string;         // effect / spell / trap / fusion / …
  race?: string;              // Dragon / Spellcaster / …
  archetype?: string;         // Blue-Eyes / Sky Striker / …
  rarity?: string;            // raw rarity name (Ultra Rare, Starlight Rare, …)
  setCode?: string;           // LOB, MRD, PSV, PHNI, …

  level?: number;
  rank?: number;
  linkRating?: number;

  atkMin?: number;
  atkMax?: number;
  defMin?: number;
  defMax?: number;

  banlistTcg?: BanlistState;

  priceMin?: number;
  priceMax?: number;

  // Sort/page + soft hints (from smart-query parser).
  sort?: FinderSort;
  page?: number;

  // Set when the user typed "cheap" or "expensive" without an
  // explicit sort. Consumed only if the caller has no sort of its
  // own; never overrides an explicit `sort` param.
  priceBiasCheap?: boolean;
  priceBiasExpensive?: boolean;
}

export const EMPTY_FILTERS: FinderFilters = { q: '' };

export const SORT_OPTIONS: readonly { key: FinderSort; label: string }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'name-asc', label: 'Name (A → Z)' },
  { key: 'name-desc', label: 'Name (Z → A)' },
  { key: 'price-asc', label: 'Price low → high' },
  { key: 'price-desc', label: 'Price high → low' },
  { key: 'atk-desc', label: 'ATK high → low' },
  { key: 'atk-asc', label: 'ATK low → high' },
  { key: 'def-desc', label: 'DEF high → low' },
  { key: 'newest', label: 'Newest set' },
  { key: 'oldest', label: 'Oldest set' },
];

const BANLIST_VALUES: readonly BanlistState[] = [
  'forbidden',
  'limited',
  'semi_limited',
  'unlimited',
];

const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((s) => s.key));

// Parse a URLSearchParams-like input into a FinderFilters. Silently
// drops values that fail validation — a malformed URL never crashes
// the page, it just falls back to a broader search.
export function parseFinderParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): FinderFilters {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const num = (key: string): number | undefined => {
    const raw = get(key);
    if (raw == null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const filters: FinderFilters = { q: (get('q') ?? '').trim() };
  const attribute = get('attribute')?.toUpperCase();
  if (attribute) filters.attribute = attribute;
  const frameType = get('frameType')?.toLowerCase();
  if (frameType) filters.frameType = frameType;
  const race = get('race');
  if (race) filters.race = race;
  const archetype = get('archetype');
  if (archetype) filters.archetype = archetype;
  const rarity = get('rarity');
  if (rarity) filters.rarity = rarity;
  const setCode = get('setCode')?.toLowerCase();
  if (setCode) filters.setCode = setCode;
  const level = num('level');
  if (level != null && level >= 0 && level <= 13) filters.level = level;
  const rank = num('rank');
  if (rank != null && rank >= 0 && rank <= 13) filters.rank = rank;
  const link = num('link');
  if (link != null && link >= 1 && link <= 8) filters.linkRating = link;
  const atkMin = num('atk_min');
  if (atkMin != null && atkMin >= 0) filters.atkMin = atkMin;
  const atkMax = num('atk_max');
  if (atkMax != null && atkMax >= 0) filters.atkMax = atkMax;
  const defMin = num('def_min');
  if (defMin != null && defMin >= 0) filters.defMin = defMin;
  const defMax = num('def_max');
  if (defMax != null && defMax >= 0) filters.defMax = defMax;
  const banlist = get('fnl')?.toLowerCase().replace(/-/g, '_');
  if (banlist && (BANLIST_VALUES as readonly string[]).includes(banlist))
    filters.banlistTcg = banlist as BanlistState;
  const priceMin = num('price_min');
  if (priceMin != null && priceMin >= 0) filters.priceMin = priceMin;
  const priceMax = num('price_max');
  if (priceMax != null && priceMax >= 0) filters.priceMax = priceMax;
  const sort = get('sort');
  if (sort && SORT_VALUES.has(sort)) filters.sort = sort as FinderSort;
  const page = num('page');
  if (page != null && page >= 1) filters.page = Math.floor(page);
  return filters;
}

// Serialise a FinderFilters back into URL query params. Omits empty
// fields so /card-finder alone survives untouched.
export function serialiseFinderParams(f: FinderFilters): URLSearchParams {
  const out = new URLSearchParams();
  if (f.q) out.set('q', f.q);
  if (f.attribute) out.set('attribute', f.attribute);
  if (f.frameType) out.set('frameType', f.frameType);
  if (f.race) out.set('race', f.race);
  if (f.archetype) out.set('archetype', f.archetype);
  if (f.rarity) out.set('rarity', f.rarity);
  if (f.setCode) out.set('setCode', f.setCode);
  if (f.level != null) out.set('level', String(f.level));
  if (f.rank != null) out.set('rank', String(f.rank));
  if (f.linkRating != null) out.set('link', String(f.linkRating));
  if (f.atkMin != null) out.set('atk_min', String(f.atkMin));
  if (f.atkMax != null) out.set('atk_max', String(f.atkMax));
  if (f.defMin != null) out.set('def_min', String(f.defMin));
  if (f.defMax != null) out.set('def_max', String(f.defMax));
  if (f.banlistTcg) out.set('fnl', f.banlistTcg);
  if (f.priceMin != null) out.set('price_min', String(f.priceMin));
  if (f.priceMax != null) out.set('price_max', String(f.priceMax));
  if (f.sort) out.set('sort', f.sort);
  if (f.page != null && f.page > 1) out.set('page', String(f.page));
  return out;
}

// Returns true when the filter set holds any structured criterion
// beyond the free-text query. Used to decide whether to noindex the
// page (any structured filter → noindex) and to render an "active
// filters" chip row.
export function hasStructuredFilters(f: FinderFilters): boolean {
  return !!(
    f.attribute ||
    f.frameType ||
    f.race ||
    f.archetype ||
    f.rarity ||
    f.setCode ||
    f.level != null ||
    f.rank != null ||
    f.linkRating != null ||
    f.atkMin != null ||
    f.atkMax != null ||
    f.defMin != null ||
    f.defMax != null ||
    f.banlistTcg ||
    f.priceMin != null ||
    f.priceMax != null ||
    f.sort ||
    (f.page != null && f.page > 1)
  );
}

// Reasonable default sort given the filter set. When the user has
// selected an ATK range or ATK-relevant filter, we lean into
// ATK-desc; when they hinted "cheap" we lean into price-asc; other-
// wise default to relevance (name match first).
export function defaultSort(f: FinderFilters): FinderSort {
  if (f.sort) return f.sort;
  if (f.priceBiasCheap) return 'price-asc';
  if (f.priceBiasExpensive) return 'price-desc';
  return 'relevance';
}
