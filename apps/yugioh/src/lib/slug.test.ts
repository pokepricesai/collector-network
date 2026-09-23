import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalisePrintingKey,
  slugMatches,
  slugToIlikePattern,
  toCardSlug,
} from './slug';

test('basic name slugging', () => {
  assert.equal(toCardSlug('Blue-Eyes White Dragon'), 'blue-eyes-white-dragon');
  assert.equal(toCardSlug('Dark Magician'), 'dark-magician');
  assert.equal(toCardSlug('Red-Eyes Black Dragon'), 'red-eyes-black-dragon');
  assert.equal(
    toCardSlug('Exodia the Forbidden One'),
    'exodia-the-forbidden-one',
  );
});

test('apostrophes disappear', () => {
  assert.equal(toCardSlug("Collector's Rare"), 'collectors-rare');
  assert.equal(toCardSlug('Sky Striker Ace - Kagari'), 'sky-striker-ace-kagari');
  assert.equal(toCardSlug('D’Aurora'), 'daurora'); // curly apostrophe
});

test('colon-heavy names collapse cleanly', () => {
  assert.equal(toCardSlug('Number 39: Utopia'), 'number-39-utopia');
  assert.equal(
    toCardSlug('CXyz Hope Chaos Barian Dragon'),
    'cxyz-hope-chaos-barian-dragon',
  );
});

test('multiple whitespace / punctuation reduce to single dash', () => {
  assert.equal(
    toCardSlug('Buster Blader,  the Dragon Destroyer'),
    'buster-blader-the-dragon-destroyer',
  );
});

test('leading/trailing junk trimmed', () => {
  assert.equal(toCardSlug('   Fire  '), 'fire');
  assert.equal(toCardSlug('---'), '');
});

test('slugMatches round-trips for known names', () => {
  assert.equal(slugMatches('Blue-Eyes White Dragon', 'blue-eyes-white-dragon'), true);
  assert.equal(slugMatches("Collector's Rare", 'collectors-rare'), true);
  assert.equal(slugMatches('Number 39: Utopia', 'number-39-utopia'), true);
});

test('slugMatches rejects near-misses', () => {
  assert.equal(slugMatches('Blue-Eyes White Dragon', 'blue-eyes-dragon'), false);
  assert.equal(slugMatches('Dark Magician', 'darkmagician'), false);
});

test('slugToIlikePattern turns dashes into % wildcards', () => {
  assert.equal(slugToIlikePattern('blue-eyes-white-dragon'), 'blue%eyes%white%dragon');
  assert.equal(slugToIlikePattern('dark-magician'), 'dark%magician');
});

test('normalisePrintingKey accepts common values', () => {
  assert.equal(normalisePrintingKey('normal'), 'normal');
  assert.equal(normalisePrintingKey('1st-edition'), '1st-edition');
  assert.equal(normalisePrintingKey('LIMITED'), 'limited');
  assert.equal(normalisePrintingKey('foil'), 'foil');
  assert.equal(normalisePrintingKey(null), 'normal');
  assert.equal(normalisePrintingKey(undefined), 'normal');
});
