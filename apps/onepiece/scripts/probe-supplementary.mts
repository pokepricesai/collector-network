#!/usr/bin/env node
// Phase B follow-up probes:
//   A) tcg_cards.rules_text — is effect text stored here for OP?
//   B) tcg_market_price_daily / tcg_graded_price_daily — cadence + range.
//   C) Retail price outlier scan — how bad can price / price_low get?
//
// READ-ONLY. Anon SELECT only. No writes.

const { createTcgClient } = await import(
  '../../../packages/database/src/client.ts'
);

const GAME_ID = 'onepiece';
const supabase = createTcgClient();

function hr(t: string): void { console.log(`\n${'═'.repeat(72)}\n${t}\n${'═'.repeat(72)}`); }
function sub(t: string): void { console.log(`\n─── ${t} ───`); }
function fmt(n: number): string { return new Intl.NumberFormat('en-US').format(n); }

// ─── A. rules_text ───────────────────────────────────────────────────────
hr('A · tcg_cards.rules_text coverage');

const { data: rtSample } = await supabase
  .from('tcg_cards')
  .select('id, name, collector_number, rarity, rules_text, gamedata')
  .eq('game_id', GAME_ID)
  .limit(20);

let nonNull = 0;
for (const row of (rtSample as any[] | null) ?? []) {
  const rt = row.rules_text as string | null;
  if (rt !== null && rt !== '') nonNull += 1;
}
console.log(`  sample: ${(rtSample as any[] | null)?.length ?? 0} rows`);
console.log(`  non-null rules_text: ${nonNull}`);

// Show 3 representative payloads whether populated or null
console.log('\n  first 3 sample rows:');
for (const row of ((rtSample as any[] | null) ?? []).slice(0, 3)) {
  console.log(`\n  ${row.collector_number}  ${row.name}`);
  console.log(`    rules_text: ${JSON.stringify(row.rules_text)}`);
  console.log(`    gamedata:   ${JSON.stringify(row.gamedata).slice(0, 300)}`);
}

// Now count non-null rules_text across the whole game.
const { count: rtTotal, error: rtCountErr } = await supabase
  .from('tcg_cards')
  .select('id', { count: 'exact', head: true })
  .eq('game_id', GAME_ID)
  .not('rules_text', 'is', null);
if (rtCountErr) {
  console.log(`  ! total-count query failed: ${rtCountErr.message}`);
} else {
  console.log(`\n  tcg_cards with non-null rules_text: ${fmt(rtTotal ?? 0)} of 5,538 (${(((rtTotal ?? 0) / 5538) * 100).toFixed(1)}%)`);
}

// If some are populated, sample a few that ARE.
const { data: rtHits } = await supabase
  .from('tcg_cards')
  .select('id, collector_number, name, rules_text')
  .eq('game_id', GAME_ID)
  .not('rules_text', 'is', null)
  .limit(5);
if ((rtHits as any[] | null)?.length) {
  sub('sample rows WITH rules_text');
  for (const row of rtHits as any[]) {
    console.log(`  ${row.collector_number}  ${row.name}`);
    console.log(`    ${(row.rules_text as string).slice(0, 200).replace(/\n/g, '⏎ ')}`);
  }
}

// ─── B. Daily price cadence + range ──────────────────────────────────────
hr('B · Daily price cadence + range');

// Pick the printing with the most graded-daily rows — that's a well-tracked
// chase card, likely to have the longest history.
const { data: topPrintings } = await supabase
  .rpc('__nonexistent_rpc__', {}) // guard: RPC path may not exist. Fall back below.
  .then(() => ({ data: null } as any))
  .catch(() => ({ data: null } as any));

// Fallback: pick the printing with the highest recent retail price.
const { data: topByPrice } = await supabase
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, price, currency, source, updated_at')
  .eq('game_id', GAME_ID)
  .not('price', 'is', null)
  .order('price', { ascending: false })
  .limit(5);

console.log('  top-priced printings (retail):');
for (const row of (topByPrice as any[] | null) ?? []) {
  console.log(`    ${row.tcg_printing_id}  ${row.currency} ${row.price}  ${row.source}  @ ${row.updated_at.slice(0, 10)}`);
}

const sampleId = (topByPrice as any[] | null)?.[0]?.tcg_printing_id as string | undefined;
if (sampleId) {
  sub(`retail daily rows for ${sampleId}`);
  const { data: retail } = await supabase
    .from('tcg_market_price_daily')
    .select('observed_on, source, currency, price, price_low, price_trend, avg_7d, avg_30d')
    .eq('game_id', GAME_ID)
    .eq('tcg_printing_id', sampleId)
    .order('observed_on', { ascending: true });
  const rows = (retail as any[] | null) ?? [];
  console.log(`  ${rows.length} rows`);
  if (rows.length > 0) {
    console.log(`  observed_on range: ${rows[0]!.observed_on} → ${rows[rows.length - 1]!.observed_on}`);
    // Distinct sources + currencies
    const groups = new Map<string, number>();
    for (const r of rows) groups.set(`${r.source}|${r.currency}`, (groups.get(`${r.source}|${r.currency}`) ?? 0) + 1);
    for (const [k, n] of groups) console.log(`    ${k}: ${n} rows`);
    // First 3 + last 3
    console.log('  first 3:');
    for (const r of rows.slice(0, 3)) console.log(`    ${r.observed_on} ${r.source} ${r.currency} ${r.price} (low ${r.price_low})`);
    console.log('  last 3:');
    for (const r of rows.slice(-3)) console.log(`    ${r.observed_on} ${r.source} ${r.currency} ${r.price} (low ${r.price_low})`);
  }

  sub(`graded daily rows for ${sampleId}`);
  const { data: graded } = await supabase
    .from('tcg_graded_price_daily')
    .select('observed_on, grader, grade, currency, price')
    .eq('game_id', GAME_ID)
    .eq('tcg_printing_id', sampleId)
    .order('observed_on', { ascending: true });
  const gRows = (graded as any[] | null) ?? [];
  console.log(`  ${gRows.length} rows`);
  if (gRows.length > 0) {
    console.log(`  observed_on range: ${gRows[0]!.observed_on} → ${gRows[gRows.length - 1]!.observed_on}`);
  }
}

// Global range of daily tables
sub('global tcg_market_price_daily range');
const { data: dailyMin } = await supabase
  .from('tcg_market_price_daily')
  .select('observed_on')
  .eq('game_id', GAME_ID)
  .order('observed_on', { ascending: true })
  .limit(1);
const { data: dailyMax } = await supabase
  .from('tcg_market_price_daily')
  .select('observed_on')
  .eq('game_id', GAME_ID)
  .order('observed_on', { ascending: false })
  .limit(1);
console.log(`  earliest: ${(dailyMin as any[] | null)?.[0]?.observed_on ?? '?'}`);
console.log(`  latest:   ${(dailyMax as any[] | null)?.[0]?.observed_on ?? '?'}`);

// ─── C. Retail price outlier scan ────────────────────────────────────────
hr('C · Retail price outlier scan');

// Grab everything with a price above $1000 or where price_low >> price.
const { data: highPrice } = await supabase
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, source, currency, price, price_low, avg_30d, updated_at')
  .eq('game_id', GAME_ID)
  .gte('price', 1000)
  .order('price', { ascending: false })
  .limit(15);
console.log(`  ${((highPrice as any[] | null) ?? []).length} rows with price ≥ 1000`);
for (const r of (highPrice as any[] | null) ?? []) {
  const ratio = r.price_low ? (r.price / r.price_low).toFixed(2) : 'null';
  console.log(`    ${r.tcg_printing_id}  ${r.currency} ${r.price}  low=${r.price_low}  ratio=${ratio}  ${r.source}`);
}

sub('rows where price_low > price × 5 (structural anomaly)');
// Cannot query price_low / price ratio directly. Pull all rows and scan.
const { data: allRetail } = await supabase
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, source, currency, price, price_low')
  .eq('game_id', GAME_ID)
  .not('price', 'is', null)
  .not('price_low', 'is', null)
  .range(0, 9999);
let anomaliesA = 0;
const examples: any[] = [];
for (const r of (allRetail as any[] | null) ?? []) {
  const p = r.price as number;
  const pl = r.price_low as number;
  if (pl > 0 && pl > p * 5) {
    anomaliesA += 1;
    if (examples.length < 8) examples.push(r);
  }
}
console.log(`  ${anomaliesA} rows`);
for (const r of examples) {
  console.log(`    ${r.tcg_printing_id}  ${r.currency}  price=${r.price}  low=${r.price_low}  source=${r.source}`);
}

sub('rows where price > $10,000 (obvious hobby-store misprints)');
const { data: superHigh } = await supabase
  .from('tcg_market_prices_current')
  .select('tcg_printing_id, source, currency, price, price_low, updated_at')
  .eq('game_id', GAME_ID)
  .gte('price', 10000)
  .order('price', { ascending: false })
  .limit(20);
for (const r of (superHigh as any[] | null) ?? []) {
  console.log(`    ${r.tcg_printing_id}  ${r.currency} ${r.price}  low=${r.price_low}  ${r.source} @ ${r.updated_at.slice(0, 10)}`);
}

hr('DONE');
console.log('No writes were performed. All queries used anon SELECT.');
