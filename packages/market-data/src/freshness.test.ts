import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness } from './freshness';

// Fixed "now" so day-math is deterministic.
const NOW = Date.parse('2026-11-04T20:00:00Z');

test('both timestamps null → unknown, no label', () => {
  const r = classifyFreshness({ providerUpdatedAt: null, ingestStartedAt: null, kind: 'retail' }, NOW);
  assert.equal(r.state, 'unknown');
  assert.equal(r.label, null);
});

test('retail fresh: ingest 2h ago, provider 1d ago → fresh, no label', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-11-03T20:00:00Z',  // 24h ago
    ingestStartedAt:   '2026-11-04T18:00:00Z',  // 2h ago
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'fresh');
  assert.equal(r.label, null);
});

test('retail recently_confirmed: ingest 2h ago, provider 30d ago → recently_confirmed + label', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-10-05T20:00:00Z',  // 30d ago
    ingestStartedAt:   '2026-11-04T18:00:00Z',  // 2h ago
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'recently_confirmed');
  assert.equal(r.label, 'Last observed 30 days ago');
});

test('retail not_recently_refreshed: ingest 7d ago, any provider → not_recently_refreshed', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-10-28T20:00:00Z',   // 7d ago (provider)
    ingestStartedAt:   '2026-10-28T20:00:00Z',   // 7d ago (ingest)
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'not_recently_refreshed');
  assert.equal(r.label, 'Last observed 7 days ago');
});

test('retail long_tail: ingest 70d ago → long_tail, label uses provider date', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-08-26T20:00:00Z',   // 70d ago
    ingestStartedAt:   '2026-08-26T20:00:00Z',   // 70d ago
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'long_tail');
  assert.equal(r.label, 'Last observed 70 days ago');
});

test('retail long_tail: 174-row style (~35d ingest, ~35d provider) is NOT long_tail yet', () => {
  // The Lorcana 174-row case as of audit: ingest 2026-09-30 (~35d),
  // provider updated_at 2026-09-30 (~35d). Should be
  // not_recently_refreshed (preserve value, label it), NOT long_tail.
  const r = classifyFreshness({
    providerUpdatedAt: '2026-09-30T02:25:51Z',
    ingestStartedAt:   '2026-09-30T06:15:49Z',
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'not_recently_refreshed');
  // 2026-09-30T02:25 → 2026-11-04T20:00 = 35d 17.6h → Math.round = 36d
  assert.equal(r.label, 'Last observed 36 days ago');
});

test('graded fresh: ingest 10h ago, provider 60d ago → fresh (graded cap is 90d)', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-09-05T20:00:00Z',   // 60d ago
    ingestStartedAt:   '2026-11-04T10:00:00Z',   // 10h ago
    kind: 'graded',
  }, NOW);
  assert.equal(r.state, 'fresh');
  assert.equal(r.label, null);
});

test('graded recently_confirmed: ingest 10h ago, provider 100d ago → recently_confirmed', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-07-27T20:00:00Z',   // 100d ago
    ingestStartedAt:   '2026-11-04T10:00:00Z',
    kind: 'graded',
  }, NOW);
  assert.equal(r.state, 'recently_confirmed');
  assert.equal(r.label, 'Last observed 100 days ago');
});

test('conservative: null ingestStartedAt with fresh provider → fresh (no over-claim)', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-11-03T20:00:00Z',  // 24h
    ingestStartedAt: null,
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'fresh');
  assert.equal(r.label, null);
});

test('conservative: null ingestStartedAt with old provider → not_recently_refreshed', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-10-01T00:00:00Z',  // ~35d ago
    ingestStartedAt: null,
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'not_recently_refreshed');
  // 2026-10-01T00:00 → 2026-11-04T20:00 = 34d 20h → Math.round = 35d
  assert.equal(r.label, 'Last observed 35 days ago');
});

test('conservative: fresh ingest + null provider → unknown (do not fabricate freshness)', () => {
  const r = classifyFreshness({
    providerUpdatedAt: null,
    ingestStartedAt: '2026-11-04T18:00:00Z',  // 2h ago
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'unknown');
  assert.equal(r.label, null);
});

test('malformed timestamps are treated as null', () => {
  const r = classifyFreshness({
    providerUpdatedAt: 'not-a-date',
    ingestStartedAt: 'also-not',
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'unknown');
  assert.equal(r.label, null);
});

test('boundary: ingest exactly 48h → still fresh (inclusive)', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-11-04T19:00:00Z',  // 1h ago
    ingestStartedAt:   '2026-11-02T20:00:00Z',  // exactly 48h ago
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'fresh');
});

test('boundary: ingest 48h+1min → not_recently_refreshed', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-11-04T19:00:00Z',
    ingestStartedAt:   '2026-11-02T19:59:00Z',  // 48h 1min
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'not_recently_refreshed');
});

test('label pluralisation: 1 day uses singular', () => {
  const r = classifyFreshness({
    providerUpdatedAt: '2026-11-03T20:00:00Z',  // 1d
    ingestStartedAt:   '2026-11-02T00:00:00Z',  // 68h
    kind: 'retail',
  }, NOW);
  assert.equal(r.state, 'not_recently_refreshed');
  assert.equal(r.label, 'Last observed 1 day ago');
});
