import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnTo } from './return-to';

test('null / undefined / empty → default', () => {
  assert.equal(safeReturnTo(null), '/account');
  assert.equal(safeReturnTo(undefined), '/account');
  assert.equal(safeReturnTo(''), '/account');
});

test('same-origin path passes through', () => {
  assert.equal(safeReturnTo('/collection'), '/collection');
  assert.equal(safeReturnTo('/card/blue-eyes-white-dragon'), '/card/blue-eyes-white-dragon');
  assert.equal(safeReturnTo('/set/lob?sort=alpha'), '/set/lob?sort=alpha');
});

test('URL-encoded path decodes', () => {
  assert.equal(safeReturnTo('%2Fcard%2Fblue-eyes-white-dragon'), '/card/blue-eyes-white-dragon');
});

test('protocol-relative // rejected (open redirect)', () => {
  assert.equal(safeReturnTo('//evil.example.com/steal'), '/account');
});

test('backslash-relative /\\evil rejected', () => {
  assert.equal(safeReturnTo('/\\evil.example.com'), '/account');
});

test('absolute URLs rejected', () => {
  assert.equal(safeReturnTo('https://evil.example.com/steal'), '/account');
  assert.equal(safeReturnTo('http://evil.example.com/'), '/account');
});

test('paths not starting with / rejected', () => {
  assert.equal(safeReturnTo('account'), '/account');
  assert.equal(safeReturnTo('javascript:alert(1)'), '/account');
});

test('auth surfaces rejected (would loop)', () => {
  assert.equal(safeReturnTo('/sign-in'), '/account');
  assert.equal(safeReturnTo('/sign-up'), '/account');
  assert.equal(safeReturnTo('/auth/callback'), '/account');
  // Query string shouldn't fool the check
  assert.equal(safeReturnTo('/sign-in?returnTo=/set/lob'), '/account');
});

test('very long paths rejected', () => {
  const bomb = '/' + 'a'.repeat(1000);
  assert.equal(safeReturnTo(bomb), '/account');
});

test('malformed encoding falls back to default', () => {
  // Bare % triggers URIError in decodeURIComponent
  assert.equal(safeReturnTo('%'), '/account');
});
