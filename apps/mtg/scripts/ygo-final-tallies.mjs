#!/usr/bin/env node
// Read-only: reconcile final daily-history totals against the report.

import { loadEnv, requireEnv, getSupabase } from '../src/lib/tcggraph/ingest-core.mjs'
loadEnv(); requireEnv('SUPABASE_SERVICE_ROLE_KEY')
const sb = getSupabase()

//  1. Total rows in each graded table.
const cur = await sb.from('tcg_graded_prices_current').select('*', { count: 'exact', head: true })
const dly = await sb.from('tcg_graded_price_daily').select('*', { count: 'exact', head: true })
console.log(`tcg_graded_prices_current: ${cur.count} rows`)
console.log(`tcg_graded_price_daily:    ${dly.count} rows`)

//  2. daily breakdown per game_id x attribution.
const rows = []
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await sb.from('tcg_graded_price_daily')
    .select('game_id, attribution').range(offset, offset + 999)
  if (error) { console.error(error.message); break }
  if (!data || data.length === 0) break
  for (const r of data) rows.push(r)
  if (data.length < 1000) break
  if (offset >= 2_000_000) break
}
const hist = new Map()
for (const r of rows) {
  const k = `${r.game_id}|${r.attribution}`
  hist.set(k, (hist.get(k) || 0) + 1)
}
console.log('\ndaily rows by (game_id, attribution):')
for (const [k, n] of Array.from(hist.entries()).sort()) {
  console.log(`  ${k.padEnd(20)} ${n}`)
}

//  3. YGO daily observations by observed_on.
const obs = []
for (let offset = 0; ; offset += 1000) {
  const { data } = await sb.from('tcg_graded_price_daily')
    .select('observed_on').eq('game_id', 'ygo').range(offset, offset + 999)
  if (!data || data.length === 0) break
  for (const r of data) obs.push(r.observed_on)
  if (data.length < 1000) break
  if (offset >= 2_000_000) break
}
const byDate = new Map()
for (const d of obs) byDate.set(d, (byDate.get(d) || 0) + 1)
console.log('\nYGO daily rows by observed_on:')
for (const [d, n] of Array.from(byDate.entries()).sort()) console.log(`  ${d}  ${n}`)

//  4. LOB-001 daily row count.
const { count: lob1Count } = await sb.from('tcg_graded_price_daily')
  .select('*', { count: 'exact', head: true }).eq('tcg_card_id', 'ygo:card:ygo_lob_001')
console.log(`\nLOB-001 daily rows total: ${lob1Count}`)

//  5. LOB-001 daily rows by (observed_on, attribution) so we can see
//  how the 18 splits.
const { data: lob1 } = await sb.from('tcg_graded_price_daily')
  .select('observed_on, attribution, grader, grade')
  .eq('tcg_card_id', 'ygo:card:ygo_lob_001')
  .order('observed_on').order('grader').order('grade')
console.log(`LOB-001 daily rows by observed_on:`)
const lob1byDate = new Map()
for (const r of lob1 ?? []) {
  const k = `${r.observed_on}|${r.attribution}`
  lob1byDate.set(k, (lob1byDate.get(k) || 0) + 1)
}
for (const [k, n] of Array.from(lob1byDate.entries()).sort()) console.log(`  ${k}  ${n}`)
