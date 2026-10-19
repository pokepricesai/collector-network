// PP-TCG-JA-INGEST-FIX §1 (operator-authorised) — seed the five JA
// (set, lang) pairs that are missing from pokemon_tcg_sets_observed
// but have provider_cards from yesterday's cycle:
//   xyp|ja, xy10|ja, sv6|ja, sm7|ja, sm8|ja  (843 cards total)
//
// Idempotent: checks for existing (code, lang) rows and only inserts
// if missing. The chunk route's in-memory dedup makes duplicates
// harmless anyway, but we don't want silent noise in sets_observed.

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

const SEED = [
  { tcg_set_code: 'xyp',  tcg_language: 'ja', tcg_set_name: 'XY Promos' },
  { tcg_set_code: 'xy10', tcg_language: 'ja', tcg_set_name: 'Awakening Psychic King' },
  { tcg_set_code: 'sv6',  tcg_language: 'ja', tcg_set_name: 'Transformation Mask' },
  { tcg_set_code: 'sm7',  tcg_language: 'ja', tcg_set_name: 'Sky-Splitting Charisma' },
  { tcg_set_code: 'sm8',  tcg_language: 'ja', tcg_set_name: 'Super-Burst Impact' },
]

console.log('[1/3] checking current state in sets_observed…')
const toInsert = []
for (const s of SEED) {
  const { data, error } = await sb.from('pokemon_tcg_sets_observed')
    .select('tcg_set_code,tcg_language')
    .eq('tcg_set_code', s.tcg_set_code)
    .eq('tcg_language', s.tcg_language)
    .limit(1)
  if (error) throw new Error(`check ${s.tcg_set_code}|${s.tcg_language}: ${error.message}`)
  if ((data || []).length === 0) {
    toInsert.push(s)
    console.log(`     + ${s.tcg_set_code}|${s.tcg_language}  "${s.tcg_set_name}"  — will insert`)
  } else {
    console.log(`     ✓ ${s.tcg_set_code}|${s.tcg_language}  already present — skipping`)
  }
}

if (toInsert.length === 0) {
  console.log('\n[done] nothing to insert — all 5 pairs already registered.')
  process.exit(0)
}

console.log(`\n[2/3] inserting ${toInsert.length} row(s)…`)
const now = new Date().toISOString()
const rows = toInsert.map(s => ({ provider: 'tcggraph', observed_at: now, ...s }))
const { error: insertErr } = await sb.from('pokemon_tcg_sets_observed').insert(rows)
if (insertErr) throw new Error(`insert: ${insertErr.message}`)
console.log(`     inserted ${rows.length} row(s)`)

console.log('\n[3/3] verifying no duplicates for the five pairs…')
const codes = SEED.map(s => s.tcg_set_code)
const { data: verify } = await sb.from('pokemon_tcg_sets_observed')
  .select('tcg_set_code,tcg_language')
  .in('tcg_set_code', codes)
const counts = {}
for (const r of (verify || [])) {
  const k = `${r.tcg_set_code}|${r.tcg_language}`
  counts[k] = (counts[k] || 0) + 1
}
for (const s of SEED) {
  const k = `${s.tcg_set_code}|${s.tcg_language}`
  const n = counts[k] || 0
  console.log(`     ${k.padEnd(14)} rows=${n}  ${n === 0 ? '✗ MISSING' : n === 1 ? '✓ unique' : '⚠ duplicate (harmless — chunk dedups in memory)'}`)
}

console.log('\n[done] seed complete.')
