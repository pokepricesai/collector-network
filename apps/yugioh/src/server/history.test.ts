import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_RANGES,
  aggregatePointsByDate,
  availableRanges,
  clipSeries,
  percentChange,
  type PricePoint,
} from './history';

const pts = (arr: [string, number][]): PricePoint[] =>
  arr.map(([date, price]) => ({ date, price }));

test('aggregatePointsByDate collapses same-date observations to median', () => {
  // Four observations on one date — the biggest Flight payload offender
  // on YGO popular cards. Must collapse to one median point.
  const input = pts([
    ['2026-09-21', 31.14],
    ['2026-09-21', 0.82],
    ['2026-09-21', 23.65],
    ['2026-09-21', 6.05],
    ['2026-09-22', 10],
  ]);
  const out = aggregatePointsByDate(input);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.date, '2026-09-21');
  // median of [0.82, 6.05, 23.65, 31.14] = (6.05 + 23.65) / 2 = 14.85
  assert.equal(out[0]!.price, 14.85);
  assert.deepEqual(out[1], { date: '2026-09-22', price: 10 });
});

test('aggregatePointsByDate preserves single-observation days unchanged', () => {
  const input = pts([
    ['2026-09-21', 10],
    ['2026-09-22', 20],
    ['2026-09-23', 30],
  ]);
  const out = aggregatePointsByDate(input);
  assert.deepEqual(out, input);
});

test('aggregatePointsByDate handles odd and even bucket sizes', () => {
  // Odd bucket of 3 → middle value
  const odd = aggregatePointsByDate(pts([
    ['2026-01-01', 1], ['2026-01-01', 2], ['2026-01-01', 100],
  ]));
  assert.deepEqual(odd, [{ date: '2026-01-01', price: 2 }]);
  // Even bucket of 2 → mean of the two
  const even = aggregatePointsByDate(pts([
    ['2026-01-01', 10], ['2026-01-01', 20],
  ]));
  assert.deepEqual(even, [{ date: '2026-01-01', price: 15 }]);
});

test('aggregatePointsByDate on empty or single-element input', () => {
  assert.deepEqual(aggregatePointsByDate([]), []);
  const single = pts([['2026-01-01', 42]]);
  assert.deepEqual(aggregatePointsByDate(single), single);
});

test('aggregatePointsByDate assumes sorted input (contract)', () => {
  // If caller breaks the sort contract, we still produce stable output
  // but don't claim correct aggregation across non-adjacent same-date
  // runs. This test locks down the current behaviour so a future change
  // doesn't silently alter it.
  const unsorted = pts([
    ['2026-09-21', 10],
    ['2026-09-22', 20],
    ['2026-09-21', 30],
  ]);
  const out = aggregatePointsByDate(unsorted);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((p) => p.date), ['2026-09-21', '2026-09-22', '2026-09-21']);
});

test('availableRanges hides ranges with insufficient depth', () => {
  const series = [{ points: pts([['2026-09-11', 1], ['2026-09-22', 2]]) }];
  const ranges = availableRanges([series], 2);
  // With only 2 days covered we must not show 30D/90D/1Y — they'd all
  // silently collapse into the same 2-point line as All.
  assert.deepEqual(
    ranges.map((r) => r.key),
    ['7d', 'all'],
  );
});

test('availableRanges shows ranges up to coverage', () => {
  const series = [{ points: pts([['2026-01-01', 1], ['2026-09-22', 2]]) }];
  const ranges = availableRanges([series], 100);
  assert.deepEqual(
    ranges.map((r) => r.key),
    ['7d', '30d', '90d', 'all'],
  );
});

test('availableRanges returns empty when no data', () => {
  assert.deepEqual(availableRanges([[]], 0), []);
  assert.deepEqual(availableRanges([[{ points: [] }]], 0), []);
});

test('clipSeries keeps only the last N days', () => {
  const s = [
    {
      points: pts([
        ['2026-09-01', 1],
        ['2026-09-15', 2],
        ['2026-09-22', 3],
      ]),
    },
  ];
  const clipped = clipSeries(s, 10, new Date('2026-09-22T00:00:00Z'));
  assert.deepEqual(
    clipped[0]!.points.map((p) => p.date),
    ['2026-09-15', '2026-09-22'],
  );
});

test('clipSeries with days=null returns all points', () => {
  const s = [{ points: pts([['2020-01-01', 1], ['2026-09-22', 2]]) }];
  assert.equal(clipSeries(s, null)[0]!.points.length, 2);
});

test('percentChange from first to last', () => {
  assert.equal(percentChange(pts([['a', 100], ['b', 110]])), 10);
  assert.equal(percentChange(pts([['a', 100], ['b', 80]])), -20);
});

test('percentChange returns null for too-short or zero-base series', () => {
  assert.equal(percentChange([]), null);
  assert.equal(percentChange(pts([['a', 5]])), null);
  assert.equal(percentChange(pts([['a', 0], ['b', 10]])), null);
});

test('TIME_RANGES stable order + shape', () => {
  assert.deepEqual(
    TIME_RANGES.map((r) => r.key),
    ['7d', '30d', '90d', '1y', 'all'],
  );
  for (const r of TIME_RANGES) {
    assert.ok(typeof r.label === 'string' && r.label.length > 0);
  }
});
