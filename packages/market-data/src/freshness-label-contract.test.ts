import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFreshness } from './freshness';

// CN-06.01-P02 — contract test that pins the mapping used by the
// Lorcana TreatmentPrice component (apps/lorcana/src/components/card/
// TreatmentPrice.tsx::freshnessLabel). Component rendering is a
// thin wrapper around this:
//
//   if (q.ingestStartedAt == null) return null;          // flag gate
//   return classifyFreshness({...}).label;               // this test
//
// Failures here imply the user-visible subtext would regress.

const NOW = Date.parse('2026-11-04T20:00:00Z');

function labelFor(providerUpdatedAt: string | null, ingestStartedAt: string | null, kind: 'retail' | 'graded'): string | null {
  // Mirror the component's pilot gate: if ingestStartedAt is nullish
  // (= pilot not enriched), suppress the label entirely.
  if (ingestStartedAt == null) return null;
  return classifyFreshness({ providerUpdatedAt, ingestStartedAt, kind }, NOW).label;
}

test('pilot OFF (no ingestStartedAt): never renders a subtext even for old provider dates', () => {
  // Pilot off means ingestStartedAt is undefined/null. Component
  // emits no label regardless of provider age.
  assert.equal(labelFor('2026-11-04T19:00:00Z', null, 'retail'), null);
  assert.equal(labelFor('2026-09-30T00:00:00Z', null, 'retail'), null);
  assert.equal(labelFor('2026-07-01T00:00:00Z', null, 'retail'), null);
  assert.equal(labelFor(null,                   null, 'retail'), null);
});

test('pilot ON + fresh: no subtext (null)', () => {
  // Ingested 2h ago, provider 1d ago, retail → fresh.
  const l = labelFor('2026-11-03T20:00:00Z', '2026-11-04T18:00:00Z', 'retail');
  assert.equal(l, null);
});

test('pilot ON + recently_confirmed: subtext with days since provider updatedAt', () => {
  // Ingested 2h ago, provider 30d ago → recently_confirmed.
  const l = labelFor('2026-10-05T20:00:00Z', '2026-11-04T18:00:00Z', 'retail');
  assert.equal(l, 'Last observed 30 days ago');
});

test('pilot ON + not_recently_refreshed: subtext present', () => {
  // Ingested 7d ago → not_recently_refreshed.
  const l = labelFor('2026-10-28T20:00:00Z', '2026-10-28T20:00:00Z', 'retail');
  assert.equal(l, 'Last observed 7 days ago');
});

test('pilot ON + long_tail (ingest 70d ago): neutral wording, no "abandoned" claim', () => {
  const l = labelFor('2026-08-26T20:00:00Z', '2026-08-26T20:00:00Z', 'retail');
  assert.equal(l, 'Last observed 70 days ago');
  assert.equal(l?.includes('abandoned'), false);
  assert.equal(l?.includes('discontinued'), false);
});

test('pilot ON + 174-row Lorcana case: labels neutrally, does not call abandoned', () => {
  // From live audit: provider updatedAt 2026-09-30T02:25:51Z, ingest
  // 2026-09-30T06:15:49Z, now 2026-11-04T20:00:00Z. Should land in
  // not_recently_refreshed with neutral "Last observed X days ago".
  const l = labelFor('2026-09-30T02:25:51Z', '2026-09-30T06:15:49Z', 'retail');
  assert.ok(l && l.startsWith('Last observed '));
  assert.ok(l && l.endsWith(' days ago'));
  assert.equal(l?.toLowerCase().includes('abandoned'), false);
  assert.equal(l?.toLowerCase().includes('discontinued'), false);
});

test('pilot ON + graded uses 90d fresh cap', () => {
  // Ingested 10h ago, provider 60d ago → fresh under graded policy.
  const l = labelFor('2026-09-05T20:00:00Z', '2026-11-04T10:00:00Z', 'graded');
  assert.equal(l, null);
});

test('pilot ON + graded recently_confirmed over 90d', () => {
  const l = labelFor('2026-07-27T20:00:00Z', '2026-11-04T10:00:00Z', 'graded');
  assert.equal(l, 'Last observed 100 days ago');
});
