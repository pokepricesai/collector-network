#!/usr/bin/env node
// Data-freshness probe. READ-ONLY. Anon SELECT.
//
// Answers:
//   A. What is the timestamp distribution on tcg_market_prices_current
//      for OP? (Is 2026-09-22 the newest across the board, or is it
//      per-source?)
//   B. What does tcg_ingest_runs say about recent OP refresh attempts?
//   C. Same for tcg_market_price_daily — most recent observed_on.

const { createTcgClient } = await import(
  '../../../packages/database/src/client.ts'
);
const s = createTcgClient();
const GAME = 'onepiece';

function hr(t: string) { console.log(`\n${'═'.repeat(72)}\n${t}\n${'═'.repeat(72)}`); }

// A. Per-source retail freshness (paged)
hr('A · tcg_market_prices_current freshness by source');
const rows: { source: string; currency: string; updated_at: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await s
    .from('tcg_market_prices_current')
    .select('source, currency, updated_at')
    .eq('game_id', GAME)
    .range(from, from + 999);
  if (error) throw new Error(error.message);
  const page = (data as typeof rows) ?? [];
  rows.push(...page);
  if (page.length < 1000) break;
}
console.log(`  ${rows.length} rows`);
const grouped = new Map<string, string[]>();
for (const r of rows) {
  const key = `${r.source}|${r.currency}`;
  const b = grouped.get(key) ?? [];
  b.push(r.updated_at);
  grouped.set(key, b);
}
for (const [k, ts] of grouped) {
  ts.sort();
  console.log(`  ${k}   n=${ts.length}   oldest=${ts[0]}   newest=${ts[ts.length - 1]}`);
}

// B. tcg_ingest_runs — recent OP entries
hr('B · tcg_ingest_runs recent OP entries');
const { data: runs, error: runErr } = await s
  .from('tcg_ingest_runs')
  .select('id, resource, status, started_at, finished_at, notes')
  .eq('game_id', GAME)
  .order('started_at', { ascending: false })
  .limit(15);
if (runErr) console.log(`  ! read failed (may not be readable via anon): ${runErr.message}`);
else {
  console.log(`  ${(runs ?? []).length} rows`);
  for (const r of (runs as any[] | null) ?? []) {
    console.log(`  ${r.started_at?.slice(0, 19) ?? '?'}  ${(r.status ?? '?').padEnd(9)}  ${(r.resource ?? '?').padEnd(14)}  finished=${r.finished_at?.slice(0, 19) ?? '?'}  notes=${JSON.stringify(r.notes ?? null).slice(0, 150)}`);
  }
}

// C. Daily table extent
hr('C · tcg_market_price_daily observed_on extent');
const { data: minD } = await s
  .from('tcg_market_price_daily')
  .select('observed_on')
  .eq('game_id', GAME)
  .order('observed_on', { ascending: true })
  .limit(1);
const { data: maxD } = await s
  .from('tcg_market_price_daily')
  .select('observed_on')
  .eq('game_id', GAME)
  .order('observed_on', { ascending: false })
  .limit(1);
console.log(`  earliest: ${(minD as any[] | null)?.[0]?.observed_on ?? '?'}`);
console.log(`  latest:   ${(maxD as any[] | null)?.[0]?.observed_on ?? '?'}`);

// Same for graded daily
const { data: minG } = await s
  .from('tcg_graded_price_daily')
  .select('observed_on')
  .eq('game_id', GAME)
  .order('observed_on', { ascending: true })
  .limit(1);
const { data: maxG } = await s
  .from('tcg_graded_price_daily')
  .select('observed_on')
  .eq('game_id', GAME)
  .order('observed_on', { ascending: false })
  .limit(1);
console.log(`  graded earliest: ${(minG as any[] | null)?.[0]?.observed_on ?? '?'}`);
console.log(`  graded latest:   ${(maxG as any[] | null)?.[0]?.observed_on ?? '?'}`);

// D. Also: graded current freshness (mostly USD)
hr('D · tcg_graded_prices_current freshness (updated_at extent)');
const gr: { updated_at: string; grader: string }[] = [];
for (let from = 0; ; from += 1000) {
  const { data } = await s
    .from('tcg_graded_prices_current')
    .select('updated_at, grader')
    .eq('game_id', GAME)
    .range(from, from + 999);
  const page = (data as typeof gr) ?? [];
  gr.push(...page);
  if (page.length < 1000) break;
}
if (gr.length > 0) {
  const gAll = gr.map((r) => r.updated_at).sort();
  console.log(`  graded n=${gr.length}   oldest=${gAll[0]}   newest=${gAll[gAll.length - 1]}`);
}

console.log('\nDONE. Read-only.');
