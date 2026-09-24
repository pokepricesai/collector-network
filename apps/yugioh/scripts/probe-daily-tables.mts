#!/usr/bin/env node
// Slice A probe: sample rows from tcg_market_price_daily +
// tcg_graded_price_daily to confirm column shape and per-printing
// coverage on production. Also measures date-range availability for
// a representative popular printing so we know which time-range
// chips to enable by default.

process.env['BYPASS_YGO_CACHE'] = '1';

const { getYugiohClient } = await import('../src/server/read.ts');

const supabase = getYugiohClient();

async function sample(table: string) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .limit(2);
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`\n[${table}] sample rows:`);
  for (const row of data ?? []) console.log(JSON.stringify(row, null, 2));
  return (data ?? [])[0] ?? null;
}

async function coverageRetail(printingId: string) {
  const { data, error, count } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on, price, currency, source, list_type, finish', {
      count: 'exact',
    })
    .eq('tcg_printing_id', printingId)
    .order('observed_on', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`retail coverage: ${error.message}`);
  const rows = data ?? [];
  const first = rows[0]?.observed_on;
  const last = rows.at(-1)?.observed_on;
  const uniqDates = new Set(rows.map((r: any) => r.observed_on)).size;
  const uniqSources = new Set(
    rows.map((r: any) => `${r.source}/${r.currency}`),
  );
  console.log(`\n[tcg_market_price_daily] printing=${printingId}`);
  console.log(`  rows returned=${rows.length}  totalCount=${count}`);
  console.log(`  observed_on: ${first} … ${last}  (${uniqDates} distinct dates)`);
  console.log(`  source/currency combos: ${[...uniqSources].join(', ')}`);
}

async function coverageGraded(
  scope: 'tcg_printing_id' | 'tcg_card_id',
  id: string,
  attribution: 'printing' | 'card',
) {
  const { data, error, count } = await supabase
    .from('tcg_graded_price_daily')
    .select(
      'observed_on, grader, grade, price, currency, attribution, card_sales_volume',
      { count: 'exact' },
    )
    .eq(scope, id)
    .eq('attribution', attribution)
    .order('observed_on', { ascending: true })
    .limit(2000);
  if (error) throw new Error(`graded coverage: ${error.message}`);
  const rows = data ?? [];
  const first = rows[0]?.observed_on;
  const last = rows.at(-1)?.observed_on;
  const uniqDates = new Set(rows.map((r: any) => r.observed_on)).size;
  const uniqGrades = new Set(
    rows.map((r: any) => `${r.grader}/${r.grade}`),
  );
  console.log(
    `\n[tcg_graded_price_daily] scope=${scope} id=${id} attribution=${attribution}`,
  );
  console.log(`  rows returned=${rows.length}  totalCount=${count}`);
  console.log(`  observed_on: ${first} … ${last}  (${uniqDates} distinct dates)`);
  console.log(`  grader/grade combos: ${[...uniqGrades].slice(0, 20).join(', ')}`);
}

console.log('=== Slice A probe: daily-history tables ===');

// Column shape probe
const retail = await sample('tcg_market_price_daily');
const graded = await sample('tcg_graded_price_daily');
if (!retail) console.log('  (retail table empty)');
if (!graded) console.log('  (graded table empty)');

// Pick a well-known printing (LOB-001 Blue-Eyes) via cards table
const { data: cardRows } = await supabase
  .from('tcg_cards')
  .select('id,name,rarity,collector_number,set_id')
  .eq('game_id', 'ygo')
  .eq('name', 'Blue-Eyes White Dragon')
  .eq('collector_number', 'LOB-001')
  .limit(5);
console.log('\n[cards] Blue-Eyes / LOB-001 candidates:');
for (const c of cardRows ?? []) {
  console.log(`  ${c.id}  rarity=${c.rarity ?? '—'}`);
}
const cardId = (cardRows ?? [])[0]?.id;

if (cardId) {
  const { data: prtRows } = await supabase
    .from('tcg_printings')
    .select('id, edition, tcggraph_printing_key')
    .eq('tcg_card_id', cardId);
  console.log(`\n[printings] for card ${cardId}:`);
  for (const p of prtRows ?? []) {
    console.log(`  ${p.id}  edition=${p.edition}  key=${p.tcggraph_printing_key}`);
  }
  const printingId = (prtRows ?? [])[0]?.id;

  if (printingId) {
    await coverageRetail(printingId);
    await coverageGraded('tcg_printing_id', printingId, 'printing');
    await coverageGraded('tcg_card_id', cardId, 'card');
  }
}

// Also probe an obviously modern popular printing for retail coverage
const { data: modernRows } = await supabase
  .from('tcg_cards')
  .select('id,name,collector_number,set_id')
  .eq('game_id', 'ygo')
  .eq('collector_number', 'MFC-000')
  .limit(1);
const modernCard = (modernRows ?? [])[0];
if (modernCard) {
  const { data: modernPrt } = await supabase
    .from('tcg_printings')
    .select('id, edition')
    .eq('tcg_card_id', modernCard.id)
    .limit(3);
  const p = (modernPrt ?? [])[0];
  if (p) {
    console.log(`\n[modern probe] ${modernCard.name} / MFC-000 / printing ${p.id}`);
    await coverageRetail(p.id);
  }
}
