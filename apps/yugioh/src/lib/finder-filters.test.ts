import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSort,
  hasStructuredFilters,
  parseFinderParams,
  serialiseFinderParams,
  type FinderFilters,
} from './finder-filters';
import { parseFinderQuery } from './finder-query';

// ── URL param parsing ────────────────────────────────────────────

test('parseFinderParams: empty input → q="" and no structured filters', () => {
  const f = parseFinderParams(new URLSearchParams());
  assert.deepEqual(f, { q: '' });
  assert.equal(hasStructuredFilters(f), false);
});

test('parseFinderParams: happy path with mixed types', () => {
  const p = new URLSearchParams(
    'q=blue&attribute=light&frameType=effect&race=Dragon&level=4&atk_min=1800&fnl=forbidden&price_min=5&price_max=50&sort=price-asc&page=2',
  );
  const f = parseFinderParams(p);
  assert.equal(f.q, 'blue');
  assert.equal(f.attribute, 'LIGHT');
  assert.equal(f.frameType, 'effect');
  assert.equal(f.race, 'Dragon');
  assert.equal(f.level, 4);
  assert.equal(f.atkMin, 1800);
  assert.equal(f.banlistTcg, 'forbidden');
  assert.equal(f.priceMin, 5);
  assert.equal(f.priceMax, 50);
  assert.equal(f.sort, 'price-asc');
  assert.equal(f.page, 2);
});

test('parseFinderParams: silently drops invalid numeric + banlist + sort values', () => {
  const p = new URLSearchParams(
    'level=abc&atk_min=-5&fnl=nonsense&sort=explode&page=notapage',
  );
  const f = parseFinderParams(p);
  // level=abc → dropped (Number.isFinite fails)
  assert.equal(f.level, undefined);
  // atk_min=-5 → dropped (>=0 guard)
  assert.equal(f.atkMin, undefined);
  // fnl=nonsense → dropped (not in BANLIST_VALUES)
  assert.equal(f.banlistTcg, undefined);
  assert.equal(f.sort, undefined);
  assert.equal(f.page, undefined);
});

test('parseFinderParams: rejects out-of-range numeric values', () => {
  const p = new URLSearchParams('level=99&link=99&rank=99');
  const f = parseFinderParams(p);
  assert.equal(f.level, undefined);
  assert.equal(f.linkRating, undefined);
  assert.equal(f.rank, undefined);
});

test('parseFinderParams: fnl accepts hyphen or underscore form', () => {
  assert.equal(parseFinderParams(new URLSearchParams('fnl=semi_limited')).banlistTcg, 'semi_limited');
  assert.equal(parseFinderParams(new URLSearchParams('fnl=semi-limited')).banlistTcg, 'semi_limited');
});

test('serialiseFinderParams: symmetric round-trip for a full filter set', () => {
  const filters: FinderFilters = {
    q: 'blue',
    attribute: 'LIGHT',
    frameType: 'effect',
    race: 'Dragon',
    archetype: 'Blue-Eyes',
    rarity: 'Ultra Rare',
    setCode: 'lob',
    level: 4,
    atkMin: 1800,
    atkMax: 3000,
    banlistTcg: 'limited',
    priceMin: 5,
    priceMax: 50,
    sort: 'price-asc',
    page: 3,
  };
  const params = serialiseFinderParams(filters);
  const round = parseFinderParams(params);
  assert.equal(round.q, 'blue');
  assert.equal(round.attribute, 'LIGHT');
  assert.equal(round.race, 'Dragon');
  assert.equal(round.level, 4);
  assert.equal(round.atkMin, 1800);
  assert.equal(round.banlistTcg, 'limited');
  assert.equal(round.priceMin, 5);
  assert.equal(round.sort, 'price-asc');
  assert.equal(round.page, 3);
});

test('serialiseFinderParams: empty filters produce empty URLSearchParams', () => {
  const p = serialiseFinderParams({ q: '' });
  assert.equal(p.toString(), '');
});

test('serialiseFinderParams: page=1 is omitted (base URL is page 1)', () => {
  const p = serialiseFinderParams({ q: '', page: 1 });
  assert.equal(p.toString(), '');
});

test('hasStructuredFilters: q alone is not structured', () => {
  assert.equal(hasStructuredFilters({ q: 'blue' }), false);
});

test('hasStructuredFilters: any explicit filter is structured', () => {
  assert.equal(hasStructuredFilters({ q: '', attribute: 'LIGHT' }), true);
  assert.equal(hasStructuredFilters({ q: '', priceMax: 20 }), true);
  assert.equal(hasStructuredFilters({ q: '', sort: 'price-asc' }), true);
  assert.equal(hasStructuredFilters({ q: '', page: 2 }), true);
});

test('defaultSort: uses explicit sort when set', () => {
  assert.equal(defaultSort({ q: '', sort: 'name-desc' }), 'name-desc');
});

test('defaultSort: cheap hint → price-asc', () => {
  assert.equal(defaultSort({ q: '', priceBiasCheap: true }), 'price-asc');
});

test('defaultSort: expensive hint → price-desc', () => {
  assert.equal(defaultSort({ q: '', priceBiasExpensive: true }), 'price-desc');
});

// ── Smart-query parser ───────────────────────────────────────────

test('parseFinderQuery: "LIGHT Dragon Level 4 1800+" → attribute + race + level + atk_min', () => {
  const f = parseFinderQuery('LIGHT Dragon Level 4 1800+ ATK');
  assert.equal(f.attribute, 'LIGHT');
  assert.equal(f.race, 'Dragon');
  assert.equal(f.level, 4);
  assert.equal(f.atkMin, 1800);
});

test('parseFinderQuery: forbidden Dragon cards → banlist + race + no free text', () => {
  const f = parseFinderQuery('forbidden Dragon cards');
  assert.equal(f.banlistTcg, 'forbidden');
  assert.equal(f.race, 'Dragon');
  assert.equal(f.q, '');
});

test('parseFinderQuery: "cheap DARK monsters" → attribute + cheap bias + no free text', () => {
  const f = parseFinderQuery('cheap DARK monsters');
  assert.equal(f.attribute, 'DARK');
  assert.equal(f.priceBiasCheap, true);
  assert.equal(f.q, '');
});

test('parseFinderQuery: "Spellcasters under $20" → race + price max', () => {
  const f = parseFinderQuery('Spellcasters under $20');
  assert.equal(f.race, 'Spellcaster');
  assert.equal(f.priceMax, 20);
});

test('parseFinderQuery: pure name search survives unrecognised tokens', () => {
  const f = parseFinderQuery('Blue-Eyes White Dragon');
  // Dragon is a monster type so it gets pulled out — remainder is name.
  assert.equal(f.race, 'Dragon');
  assert.equal(f.q, 'blue-eyes white');
});

test('parseFinderQuery: "rank 4 Xyz" → rank + frame', () => {
  const f = parseFinderQuery('rank 4 xyz');
  assert.equal(f.rank, 4);
  assert.equal(f.frameType, 'xyz');
});

test('parseFinderQuery: link-3 monster → linkRating + frame', () => {
  const f = parseFinderQuery('Link-3 monster');
  assert.equal(f.linkRating, 3);
  assert.equal(f.frameType, 'link');
});

test('parseFinderQuery: no vocabulary match → all text into q', () => {
  const f = parseFinderQuery('summoner monk');
  assert.equal(f.q, 'summoner monk');
  assert.equal(f.attribute, undefined);
  assert.equal(f.race, undefined);
});

test('parseFinderQuery: nothing at all → empty filters', () => {
  const f = parseFinderQuery('');
  assert.equal(f.q, '');
  assert.equal(f.attribute, undefined);
});
