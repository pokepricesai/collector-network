import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeSetCode, normaliseSetCode } from '../server/search';

test('classic set codes are recognised', () => {
  assert.equal(looksLikeSetCode('LOB-001'), true);
  assert.equal(looksLikeSetCode('LOB001'), true);
  assert.equal(looksLikeSetCode('LOB 001'), true);
  assert.equal(looksLikeSetCode('lob-001'), true);
});

test('modern set codes with region are recognised', () => {
  assert.equal(looksLikeSetCode('BLMM-EN001'), true);
  assert.equal(looksLikeSetCode('RA05-EN001'), true);
  assert.equal(looksLikeSetCode('L26D-ENS24'), true);
  assert.equal(looksLikeSetCode('25YC-ENP01'), true);
});

test('non-set-code queries are not misidentified', () => {
  assert.equal(looksLikeSetCode('Blue-Eyes'), false);
  assert.equal(looksLikeSetCode('sky striker'), false);
  assert.equal(looksLikeSetCode('ghost rare'), false);
  assert.equal(looksLikeSetCode('a'), false);
  assert.equal(looksLikeSetCode(''), false);
});

test('normaliseSetCode canonicalises spacing + case', () => {
  assert.equal(normaliseSetCode('lob 001'), 'LOB-001');
  assert.equal(normaliseSetCode('lob001'), 'LOB-001');
  assert.equal(normaliseSetCode('LOB-001'), 'LOB-001');
  assert.equal(normaliseSetCode('BLMM-EN001'), 'BLMM-EN001');
  assert.equal(normaliseSetCode('blmm-en001'), 'BLMM-EN001');
  assert.equal(normaliseSetCode('L26D-ENS24'), 'L26D-ENS24');
});

test('normaliseSetCode preserves an already-dashed input', () => {
  assert.equal(normaliseSetCode('25YC-ENP01'), '25YC-ENP01');
});
