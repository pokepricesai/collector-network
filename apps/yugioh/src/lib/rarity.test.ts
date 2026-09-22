import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyHasSpectral, normaliseRarity } from './rarity';

test('null / undefined / empty → other', () => {
  assert.equal(normaliseRarity(null), 'other');
  assert.equal(normaliseRarity(undefined), 'other');
  assert.equal(normaliseRarity(''), 'other');
});

test('common rarity families map correctly', () => {
  assert.equal(normaliseRarity('Common'), 'common');
  assert.equal(normaliseRarity('common'), 'common');
  assert.equal(normaliseRarity('  Common  '), 'common');
  assert.equal(normaliseRarity('Rare'), 'rare');
  assert.equal(normaliseRarity('Super Rare'), 'super');
  assert.equal(normaliseRarity('Ultra Rare'), 'ultra');
  assert.equal(normaliseRarity('Ultimate Rare'), 'ultimate');
});

test('secret family collapses Ultra/Extra Secret and the "Extra Secret" typo', () => {
  assert.equal(normaliseRarity('Secret Rare'), 'secret');
  assert.equal(normaliseRarity('Ultra Secret Rare'), 'secret');
  assert.equal(normaliseRarity('Extra Secret Rare'), 'secret');
  assert.equal(normaliseRarity('Extra Secret'), 'secret'); // data-quality anomaly
});

test('prismatic + collector families are distinct', () => {
  assert.equal(normaliseRarity('Prismatic Secret Rare'), 'prismatic-secret');
  assert.equal(normaliseRarity("Collector's Rare"), 'collectors');
  assert.equal(normaliseRarity("Prismatic Collector's Rare"), 'prismatic-collectors');
  assert.equal(normaliseRarity('Ghost Rare'), 'ghost');
  assert.equal(normaliseRarity('Starlight Rare'), 'starlight');
  assert.equal(normaliseRarity('Quarter Century Secret Rare'), 'qcsr');
});

test('curly apostrophe variants of "Collector\'s" are handled', () => {
  assert.equal(normaliseRarity('Collector’s Rare'), 'collectors');
  assert.equal(normaliseRarity('Collector‘s Rare'), 'collectors');
});

test('gold, platinum, and parallel families collapse variants', () => {
  assert.equal(normaliseRarity('Gold Rare'), 'gold');
  assert.equal(normaliseRarity('Premium Gold Rare'), 'gold');
  assert.equal(normaliseRarity('Gold Secret Rare'), 'gold');
  assert.equal(normaliseRarity('Platinum Rare'), 'platinum');
  assert.equal(normaliseRarity('Platinum Secret Rare'), 'platinum');
  assert.equal(normaliseRarity('Parallel Rare'), 'parallel');
  assert.equal(normaliseRarity('Mosaic Rare'), 'parallel');
  assert.equal(normaliseRarity('Shatterfoil Rare'), 'parallel');
  assert.equal(normaliseRarity('Starfoil Rare'), 'parallel');
  assert.equal(normaliseRarity("Pharaoh's Rare"), 'parallel');
  assert.equal(normaliseRarity('Duel Terminal Normal Parallel Rare'), 'parallel');
});

test('unknown values fall through to other — no throws', () => {
  assert.equal(normaliseRarity('Some New 2027 Rarity'), 'other');
  assert.equal(normaliseRarity('New artwork'), 'other'); // production data anomaly
  assert.equal(normaliseRarity('random-string-42'), 'other');
});

test('spectral families are marked', () => {
  assert.equal(familyHasSpectral('secret'), true);
  assert.equal(familyHasSpectral('prismatic-secret'), true);
  assert.equal(familyHasSpectral('starlight'), true);
  assert.equal(familyHasSpectral('qcsr'), true);
  assert.equal(familyHasSpectral('prismatic-collectors'), true);
  assert.equal(familyHasSpectral('common'), false);
  assert.equal(familyHasSpectral('gold'), false);
  assert.equal(familyHasSpectral('other'), false);
});
