import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseFnl } from './fnl';

test('canonical banlist strings pass through', () => {
  assert.equal(normaliseFnl('forbidden'), 'forbidden');
  assert.equal(normaliseFnl('limited'), 'limited');
  assert.equal(normaliseFnl('semi-limited'), 'semi-limited');
  assert.equal(normaliseFnl('unlimited'), 'unlimited');
});

test('case-insensitive and space-tolerant', () => {
  assert.equal(normaliseFnl('FORBIDDEN'), 'forbidden');
  assert.equal(normaliseFnl('Semi Limited'), 'semi-limited');
  assert.equal(normaliseFnl('semilimited'), 'semi-limited');
});

test('unknown / missing collapses to unknown, never "unlimited"', () => {
  assert.equal(normaliseFnl(null), 'unknown');
  assert.equal(normaliseFnl(undefined), 'unknown');
  assert.equal(normaliseFnl(''), 'unknown');
  assert.equal(normaliseFnl('mystery-status'), 'unknown');
});
