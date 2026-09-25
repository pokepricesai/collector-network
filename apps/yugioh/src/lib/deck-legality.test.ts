import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedSections,
  frameLabel,
  isMonsterFrame,
  normaliseCardKey,
  readFnlStatus,
} from './deck-identity';
import {
  evaluateDeckLegality,
  validatePlacement,
  type DeckCardInput,
} from './deck-legality';

// ── identity normalisation ────────────────────────────────

test('normaliseCardKey is deterministic + idempotent', () => {
  const inputs = [
    'Ash Blossom & Joyous Spring',
    '  ash   BLOSSOM & joyous spring  ',
    'Ash Blossom & Joyous Spring',
  ];
  const keys = inputs.map(normaliseCardKey);
  assert.equal(new Set(keys).size, 1);
  assert.equal(normaliseCardKey(keys[0]!), keys[0]);
});

test('normaliseCardKey folds accented reprints together', () => {
  const a = normaliseCardKey('Grepher');
  const b = normaliseCardKey('Grépher');
  assert.equal(a, b);
});

test('normaliseCardKey preserves distinguishing punctuation', () => {
  assert.notEqual(
    normaliseCardKey('Number 39: Utopia'),
    normaliseCardKey('Number 39 Utopia'),
  );
});

test('allowedSections keeps Extra-Deck frames out of Main', () => {
  for (const ft of ['fusion', 'synchro', 'xyz', 'link']) {
    assert.deepEqual(allowedSections(ft), ['extra']);
  }
  for (const ft of ['normal', 'effect', 'ritual', 'spell', 'trap']) {
    assert.deepEqual(allowedSections(ft), ['main', 'side']);
  }
});

test('readFnlStatus reads TCG banlist entries only', () => {
  assert.equal(readFnlStatus({ banlist: { tcg: 'forbidden' } }), 'forbidden');
  assert.equal(readFnlStatus({ banlist: { tcg: 'Limited' } }), 'limited');
  assert.equal(readFnlStatus({ banlist: { tcg: 'semi_limited' } }), 'semi-limited');
  assert.equal(readFnlStatus({ banlist: { tcg: 'semi-limited' } }), 'semi-limited');
  // OCG entry alone must not affect TCG status.
  assert.equal(readFnlStatus({ banlist: { ocg: 'forbidden' } }), 'unlimited');
  assert.equal(readFnlStatus(null), 'unlimited');
  assert.equal(readFnlStatus({}), 'unlimited');
});

test('frameLabel + isMonsterFrame agree on spells/traps', () => {
  assert.equal(frameLabel('spell'), 'Spell Card');
  assert.equal(frameLabel('trap'), 'Trap Card');
  assert.equal(isMonsterFrame('spell'), false);
  assert.equal(isMonsterFrame('effect'), true);
  assert.equal(isMonsterFrame('link'), true);
});

// ── legality: distinguishes incomplete vs illegal vs legal ──

function row(over: Partial<DeckCardInput>): DeckCardInput {
  return {
    card_key: over.card_key ?? 'x',
    card_name: over.card_name ?? 'X',
    section: over.section ?? 'main',
    quantity: over.quantity ?? 1,
    fnlStatus: over.fnlStatus ?? 'unlimited',
    frameType: over.frameType ?? 'effect',
  };
}

test('8-card deck is INCOMPLETE, not illegal', () => {
  const rows = Array.from({ length: 8 }, (_, i) =>
    row({ card_key: `k${i}`, card_name: `Card ${i}` }),
  );
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'incomplete');
  assert.equal(r.counts.main, 8);
  assert.ok(r.issues.some((i) => i.code === 'main-below-min' && i.severity === 'info'));
});

test('40-card unlimited deck is LEGAL', () => {
  const rows: DeckCardInput[] = [];
  for (let i = 0; i < 14; i++) rows.push(row({ card_key: `k${i}`, card_name: `Card ${i}`, quantity: 3 }));
  rows[0]!.quantity = 1; // 3*13 + 1 = 40
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'legal');
  assert.equal(r.counts.main, 40);
});

test('deck with a Forbidden card is ILLEGAL', () => {
  const rows = [
    row({ card_key: 'pot-of-greed', card_name: 'Pot of Greed', fnlStatus: 'forbidden', quantity: 1 }),
    ...Array.from({ length: 40 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  const forb = r.issues.find((i) => i.code === 'forbidden-card');
  assert.ok(forb);
  assert.equal(forb!.card_key, 'pot-of-greed');
});

test('Limited card at qty=2 is ILLEGAL with over-copy-cap', () => {
  const rows = [
    row({ card_key: 'monster-reborn', card_name: 'Monster Reborn', fnlStatus: 'limited', quantity: 2 }),
    ...Array.from({ length: 38 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  const issue = r.issues.find((i) => i.code === 'over-copy-cap');
  assert.ok(issue);
  assert.equal(issue!.card_key, 'monster-reborn');
});

test('Semi-Limited at qty=3 is ILLEGAL', () => {
  const rows = [
    row({ card_key: 'semi', card_name: 'Semi', fnlStatus: 'semi-limited', quantity: 3 }),
    ...Array.from({ length: 37 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  const issue = r.issues.find((i) => i.code === 'over-copy-cap');
  assert.ok(issue);
  assert.equal(issue!.card_name, 'Semi');
});

test('copy cap sums Main + Extra + Side (Limited cannot hide in Side)', () => {
  const rows = [
    row({ card_key: 'lim', card_name: 'Lim', fnlStatus: 'limited', section: 'main', quantity: 1 }),
    row({ card_key: 'lim', card_name: 'Lim', fnlStatus: 'limited', section: 'side', quantity: 1 }),
    ...Array.from({ length: 39 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  assert.ok(r.issues.some((i) => i.code === 'over-copy-cap' && i.card_key === 'lim'));
});

test('Extra-Deck monster placed in Main is ILLEGAL', () => {
  const rows = [
    row({ card_key: 'accesscode', card_name: 'Accesscode Talker', frameType: 'link', section: 'main' }),
    ...Array.from({ length: 40 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  assert.ok(r.issues.some((i) => i.code === 'extra-in-main-or-side'));
});

test('non-Extra card in Extra is ILLEGAL', () => {
  const rows = [
    row({ card_key: 'ash', card_name: 'Ash', frameType: 'effect', section: 'extra' }),
    ...Array.from({ length: 40 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
  ];
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  assert.ok(r.issues.some((i) => i.code === 'non-extra-in-extra'));
});

test('Main above max reports precise overflow', () => {
  const rows = Array.from({ length: 21 }, (_, i) =>
    row({ card_key: `k${i}`, card_name: `Card ${i}`, quantity: 3 }),
  );
  // 21 * 3 = 63 → 3 over max 60
  const r = evaluateDeckLegality(rows);
  assert.equal(r.state, 'illegal');
  const issue = r.issues.find((i) => i.code === 'main-above-max');
  assert.ok(issue);
  assert.ok(issue!.message.includes('by 3'));
});

test('Extra above max reports precise overflow', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
    ...Array.from({ length: 16 }, (_, i) =>
      row({
        card_key: `ex${i}`,
        card_name: `Ex ${i}`,
        section: 'extra',
        frameType: 'xyz',
      }),
    ),
  ];
  const r = evaluateDeckLegality(rows);
  const issue = r.issues.find((i) => i.code === 'extra-above-max');
  assert.ok(issue);
  assert.ok(issue!.message.includes('by 1'));
});

test('Side above max reports precise overflow', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => row({ card_key: `k${i}`, card_name: `Card ${i}` })),
    ...Array.from({ length: 16 }, (_, i) =>
      row({ card_key: `sd${i}`, card_name: `Sd ${i}`, section: 'side' }),
    ),
  ];
  const r = evaluateDeckLegality(rows);
  assert.ok(r.issues.some((i) => i.code === 'side-above-max'));
});

// ── placement validation ─────────────────────────────────

test('validatePlacement enforces Extra-Deck-monster placement', () => {
  const bad = validatePlacement({
    section: 'main',
    frameType: 'link',
    fnlStatus: 'unlimited',
    existingSectionCount: 0,
    existingTotalAcrossSections: 0,
    deltaQty: 1,
  });
  assert.equal(bad.ok, false);
});

test('validatePlacement enforces section-max', () => {
  const bad = validatePlacement({
    section: 'main',
    frameType: 'effect',
    fnlStatus: 'unlimited',
    existingSectionCount: 60,
    existingTotalAcrossSections: 0,
    deltaQty: 1,
  });
  assert.equal(bad.ok, false);
});

test('validatePlacement enforces F&L copy cap across sections', () => {
  const bad = validatePlacement({
    section: 'side',
    frameType: 'effect',
    fnlStatus: 'limited',
    existingSectionCount: 0,
    existingTotalAcrossSections: 1, // already 1 in Main
    deltaQty: 1,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reason!.includes('capped at 1'));
});

test('validatePlacement blocks Forbidden', () => {
  const bad = validatePlacement({
    section: 'main',
    frameType: 'effect',
    fnlStatus: 'forbidden',
    existingSectionCount: 0,
    existingTotalAcrossSections: 0,
    deltaQty: 1,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reason!.toLowerCase().includes('forbidden'));
});

test('validatePlacement allows a valid Extra add', () => {
  const ok = validatePlacement({
    section: 'extra',
    frameType: 'xyz',
    fnlStatus: 'unlimited',
    existingSectionCount: 0,
    existingTotalAcrossSections: 0,
    deltaQty: 1,
  });
  assert.equal(ok.ok, true);
});

test('validatePlacement guards against negative section count', () => {
  const bad = validatePlacement({
    section: 'main',
    frameType: 'effect',
    fnlStatus: 'unlimited',
    existingSectionCount: 0,
    existingTotalAcrossSections: 0,
    deltaQty: -1,
  });
  assert.equal(bad.ok, false);
});
