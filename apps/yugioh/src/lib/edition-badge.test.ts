import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseEdition } from '../server/edition';

// Edition normalisation must not silently claim "Unlimited" from NULL.
// Production data does not distinguish Unlimited from "no edition axis"
// — see docs/yugioh/data-audit.md §5.

test('1st_edition passes through', () => {
  assert.equal(normaliseEdition('1st_edition'), '1st_edition');
});

test('limited passes through', () => {
  assert.equal(normaliseEdition('limited'), 'limited');
});

test('NULL / undefined / empty → unlimited_or_unknown (never "unlimited")', () => {
  assert.equal(normaliseEdition(null), 'unlimited_or_unknown');
  assert.equal(normaliseEdition(undefined), 'unlimited_or_unknown');
  assert.equal(normaliseEdition(''), 'unlimited_or_unknown');
});

test('unrecognised strings fall through to unlimited_or_unknown', () => {
  assert.equal(normaliseEdition('duel_terminal'), 'unlimited_or_unknown');
  assert.equal(normaliseEdition('1st Edition'), 'unlimited_or_unknown'); // whitespace differs
  assert.equal(normaliseEdition('unlimited'), 'unlimited_or_unknown'); // literally the string 'unlimited' is NOT accepted — production never stores this
});
