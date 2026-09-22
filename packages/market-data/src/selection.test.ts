import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupQuotesByCurrency, selectPreferredRetailQuote } from './selection';
import type { RetailQuote } from './types';

function q(overrides: Partial<RetailQuote>): RetailQuote {
  return {
    printingId: 'ygo:print:sample:normal:en',
    source: 'tcggraph.tcgplayer',
    listType: 'retail',
    region: 'NA',
    currency: 'USD',
    finish: 'nonfoil',
    price: 10,
    priceLow: 5,
    priceTrend: null,
    avg1d: null,
    avg7d: null,
    avg30d: null,
    updatedAt: '2026-09-20T00:00:00Z',
    ...overrides,
  };
}

test('selects USD when USD preferred and available', () => {
  const chosen = selectPreferredRetailQuote(
    [q({ currency: 'EUR', price: 12 }), q({ currency: 'USD', price: 10 })],
    'USD',
  );
  assert.equal(chosen?.currency, 'USD');
  assert.equal(chosen?.price, 10);
});

test('falls back to any-currency quote when preferred currency missing', () => {
  const chosen = selectPreferredRetailQuote([q({ currency: 'EUR', price: 12 })], 'USD');
  assert.equal(chosen?.currency, 'EUR');
});

test('picks the freshest quote when multiple in same currency', () => {
  const chosen = selectPreferredRetailQuote(
    [
      q({ currency: 'USD', price: 10, updatedAt: '2026-09-19T00:00:00Z' }),
      q({ currency: 'USD', price: 8, updatedAt: '2026-09-20T00:00:00Z' }),
    ],
    'USD',
  );
  assert.equal(chosen?.price, 8, 'freshest wins');
});

test('null prices are excluded even if freshest', () => {
  const chosen = selectPreferredRetailQuote(
    [
      q({ currency: 'USD', price: null, updatedAt: '2026-09-22T00:00:00Z' }),
      q({ currency: 'USD', price: 10, updatedAt: '2026-09-10T00:00:00Z' }),
    ],
    'USD',
  );
  assert.equal(chosen?.price, 10);
});

test('empty array returns null, never crashes', () => {
  assert.equal(selectPreferredRetailQuote([], 'USD'), null);
});

test('groupQuotesByCurrency keeps currencies apart', () => {
  const grouped = groupQuotesByCurrency([
    q({ currency: 'USD', price: 10 }),
    q({ currency: 'EUR', price: 12 }),
    q({ currency: 'USD', price: 11 }),
  ]);
  assert.equal(grouped.get('USD')?.length, 2);
  assert.equal(grouped.get('EUR')?.length, 1);
});
