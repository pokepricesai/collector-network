import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIME_RANGES,
  availableRanges,
  clipSeries,
  percentChange,
  type PricePoint,
} from './history';

const pts = (arr: [string, number][]): PricePoint[] =>
  arr.map(([date, price]) => ({ date, price }));

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
