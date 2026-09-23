import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TcgGradedPriceCurrent } from '@collector-network/database';
import { splitGradedRows } from './pricing';

// Regression fixtures for the 4 named Slice-6 test cards. Attribution
// must be preserved through the split so downstream UI never renders a
// card-scoped quote underneath a specific-printing heading.

function row(overrides: Partial<TcgGradedPriceCurrent> = {}): TcgGradedPriceCurrent {
  return {
    tcg_printing_id: null,
    tcg_card_id: null,
    attribution: 'printing',
    game_id: 'ygo',
    grader: 'psa',
    grade: '10',
    currency: 'USD',
    price: 100,
    card_sales_volume: 10,
    updated_at: '2026-09-23T00:00:00Z',
    ingested_at: '2026-09-23T00:00:00Z',
    source_run_id: null,
    ...overrides,
  };
}

test('LOB-001 Blue-Eyes: card-scoped rows keep cardId, printingId null', () => {
  const rows: TcgGradedPriceCurrent[] = [
    row({
      attribution: 'card',
      tcg_card_id: 'ygo:card:ygo_lob_001',
      grader: 'psa',
      grade: '10',
      price: 5450,
    }),
    row({
      attribution: 'card',
      tcg_card_id: 'ygo:card:ygo_lob_001',
      grader: 'bgs',
      grade: '10',
      price: 7085,
    }),
    row({
      attribution: 'card',
      tcg_card_id: 'ygo:card:ygo_lob_001',
      grader: 'raw',
      grade: 'ungraded',
      price: 75,
    }),
  ];
  const { raw, graded } = splitGradedRows(rows);
  for (const q of raw) {
    assert.equal(q.attribution, 'card', 'raw preserves card attribution');
    assert.equal(q.printingId, null, 'card-scoped raw has null printingId');
    assert.equal(q.cardId, 'ygo:card:ygo_lob_001');
  }
  for (const q of graded) {
    assert.equal(q.attribution, 'card', 'graded preserves card attribution');
    assert.equal(q.printingId, null, 'card-scoped graded has null printingId');
    assert.equal(q.cardId, 'ygo:card:ygo_lob_001');
  }
});

test('MZTM-EN070 Retiari: printing-scoped rows keep printingId, cardId null', () => {
  const printingId = 'ygo:print:ygo_mztm_en070:1st-edition:en';
  const rows: TcgGradedPriceCurrent[] = [
    row({
      attribution: 'printing',
      tcg_printing_id: printingId,
      grader: 'psa',
      grade: '10',
      price: 31.44,
    }),
    row({
      attribution: 'printing',
      tcg_printing_id: printingId,
      grader: 'raw',
      grade: 'ungraded',
      price: 0.5,
    }),
  ];
  const { raw, graded } = splitGradedRows(rows);
  for (const q of raw) {
    assert.equal(q.attribution, 'printing');
    assert.equal(q.printingId, printingId);
    assert.equal(q.cardId, null);
  }
  for (const q of graded) {
    assert.equal(q.attribution, 'printing');
    assert.equal(q.printingId, printingId);
    assert.equal(q.cardId, null);
  }
});

test('mixed attribution splits raw vs graded, preserves attribution flag', () => {
  const rows: TcgGradedPriceCurrent[] = [
    row({
      attribution: 'card',
      tcg_card_id: 'ygo:card:ygo_lob_001',
      grader: 'psa',
      grade: '10',
      price: 5450,
    }),
    row({
      attribution: 'printing',
      tcg_printing_id: 'ygo:print:ygo_mztm_en070:1st-edition:en',
      grader: 'psa',
      grade: '10',
      price: 31.44,
    }),
  ];
  const { graded } = splitGradedRows(rows);
  const attributions = graded.map((q) => q.attribution).sort();
  assert.deepEqual(attributions, ['card', 'printing']);
  const card = graded.find((q) => q.attribution === 'card');
  const printing = graded.find((q) => q.attribution === 'printing');
  assert.equal(card?.cardId, 'ygo:card:ygo_lob_001');
  assert.equal(card?.printingId, null);
  assert.equal(printing?.printingId, 'ygo:print:ygo_mztm_en070:1st-edition:en');
  assert.equal(printing?.cardId, null);
});

test('DB1-EN249 Earthbound Spirit: foil + normal same collector_number are separate printings', () => {
  // Structural expectation captured in a fixture — the production
  // audit (Slice 6 probe) confirmed both printings exist and both
  // carry attribution='card' graded quotes on the tcg_card row.
  const cardId = 'ygo:card:ygo_db1_en249';
  const foil = 'ygo:print:ygo_db1_en249:foil:en';
  const normal = 'ygo:print:ygo_db1_en249:normal:en';
  const rows: TcgGradedPriceCurrent[] = [
    row({
      attribution: 'card',
      tcg_card_id: cardId,
      grader: 'psa',
      grade: '10',
      price: 25,
    }),
  ];
  const { graded } = splitGradedRows(rows);
  // The quote must not carry any specific printingId — the UI would
  // otherwise be tempted to render it under foil OR normal alone.
  for (const q of graded) {
    assert.equal(q.printingId, null);
    assert.notEqual(q.printingId, foil);
    assert.notEqual(q.printingId, normal);
    assert.equal(q.cardId, cardId);
  }
});
