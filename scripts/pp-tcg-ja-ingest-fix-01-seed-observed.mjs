// PP-TCG-JA-INGEST-FIX §2 — seed pokemon_tcg_sets_observed with
// the JA variants of shared codes that /v1/sets does not emit as JA.
//
// Discovery (/api/cron/pp-tcg-discover) populates sets_observed from
// TCGGraph's /v1/sets endpoint, which for codes like `xy6`, `sv3`,
// `sm9` only returns the EN variant. The initial migrate-01 batch
// seeded provider_cards for BOTH EN and JA, so we KNOW the JA codes
// exist — we just need them in sets_observed for the chunked cron.
//
// This script reads distinct (set_code, language='ja', set_name)
// tuples from provider_cards for codes stuck on the migrate-01
// catalogue version, and upserts a sets_observed row per tuple.
// Idempotent — safe to re-run.

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

// 1. Find all stale JA-only codes (catalogue_version='2026-10-18-pp-tcg-migrate-01').
const stale = []
let from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_set_code, tcg_set_name, tcg_language')
    .eq('catalogue_version', '2026-10-18-pp-tcg-migrate-01')
    .range(from, from + 999)
  if (!data || !data.length) break
  stale.push(...data)
  if (data.length < 1000) break
  from += 1000
}

// Collapse to distinct (code, lang, name) tuples
const tuples = new Map()
for (const r of stale) {
  const key = `${r.tcg_set_code}|${r.tcg_language}`
  if (!tuples.has(key)) tuples.set(key, { tcg_set_code: r.tcg_set_code, tcg_set_name: r.tcg_set_name, tcg_language: r.tcg_language, count: 0 })
  tuples.get(key).count++
}
console.log(`[1/3] ${stale.length} stale cards across ${tuples.size} (code, lang) tuples:`)
for (const [k, v] of tuples) console.log(`     ${k.padEnd(14)}  "${v.tcg_set_name}"  (${v.count} cards)`)

// 2. Find which of those are missing from sets_observed
const codes = [...new Set([...tuples.values()].map(t => t.tcg_set_code))]
const { data: observed } = await sb.from('pokemon_tcg_sets_observed')
  .select('tcg_set_code, tcg_language')
  .in('tcg_set_code', codes)
const observedPairs = new Set((observed || []).map(r => `${r.tcg_set_code}|${r.tcg_language}`))
const missing = [...tuples.values()].filter(t => !observedPairs.has(`${t.tcg_set_code}|${t.tcg_language}`))

console.log(`\n[2/3] of those tuples, ${missing.length} are missing from sets_observed:`)
for (const m of missing) console.log(`     + ${m.tcg_set_code}|${m.tcg_language}  "${m.tcg_set_name}"`)

if (missing.length === 0) {
  console.log('\n[done] nothing to seed.')
  process.exit(0)
}

// 3. Upsert
const now = new Date().toISOString()
const rows = missing.map(m => ({
  provider: 'tcggraph',
  tcg_set_code: m.tcg_set_code,
  tcg_set_name: m.tcg_set_name,
  tcg_language: m.tcg_language,
  observed_at: now,
}))
// sets_observed has no composite unique constraint — plain INSERT.
// The chunk route dedups by (code, lang) in memory, so duplicates
// here are harmless.
const { error } = await sb.from('pokemon_tcg_sets_observed').insert(rows)
if (error) throw new Error(`insert: ${error.message}`)
console.log(`\n[3/3] seeded ${rows.length} JA observations. Next chunk cycle will refresh these.`)
