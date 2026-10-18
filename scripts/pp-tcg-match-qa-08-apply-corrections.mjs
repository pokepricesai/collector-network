// PP-TCG-QA-FINAL §4 — transactional, resumable, audited corrections.
//
// Replaces the earlier pp-tcg-match-qa-04 script. Key differences:
//   • Pre-registers run_id in pokemon_tcg_qa_correction_runs BEFORE
//     any writes (so a crash doesn't leave the run untracked)
//   • Each batch is one Postgres function call = one transaction;
//     UPDATE + audit INSERT atomic
//   • Resumable: re-run with same run_id to continue after a crash
//   • Rollback: --rollback <run_id> reverses the entire run via the
//     RPC function (writes rollback audit rows)
//
// Usage:
//   node scripts/pp-tcg-match-qa-08-apply-corrections.mjs                      # dry-run
//   node scripts/pp-tcg-match-qa-08-apply-corrections.mjs --apply              # apply with new run_id
//   node scripts/pp-tcg-match-qa-08-apply-corrections.mjs --apply --run <id>   # resume existing run
//   node scripts/pp-tcg-match-qa-08-apply-corrections.mjs --rollback <run_id>  # reverse an applied run

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const ROLLBACK_IDX = process.argv.indexOf('--rollback')
const ROLLBACK_RUN_ID = ROLLBACK_IDX >= 0 ? process.argv[ROLLBACK_IDX + 1] : null
const RUN_FLAG_IDX = process.argv.indexOf('--run')
const EXPLICIT_RUN_ID = RUN_FLAG_IDX >= 0 ? process.argv[RUN_FLAG_IDX + 1] : null
const BATCH_SIZE = 500

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

async function fetchAll(table, select, filters = (q) => q) {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filters(sb.from(table).select(select)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

// ----------- ROLLBACK MODE -----------
if (ROLLBACK_RUN_ID) {
  console.log(`\n=== ROLLBACK ${ROLLBACK_RUN_ID} ===\n`)
  const { data, error } = await sb.rpc('rollback_pokemon_tcg_qa_correction_run', { p_run_id: ROLLBACK_RUN_ID })
  if (error) throw new Error(`rollback: ${error.message}`)
  console.log(`  reverted ${data} mapping(s)`)
  console.log('[done]')
  process.exit(0)
}

// ----------- DRY-RUN + APPLY -----------
console.log(`\n=== PP-TCG-QA-FINAL correction · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`)

console.log('[1/5] fetching dry-run data…')
const corrections = await fetchAll(
  'v_pokemon_tcg_pricing_eligibility_corrections',
  'mapping_id,pp_card_slug,current_eligibility,recommended_eligibility,risk_class',
)
console.log(`     ${corrections.length} corrections proposed`)

// Mirror the SQL pokemon_tcg_eligibility_rank function: uncertain and
// not_eligible are tied at 4 (both block all adapter display).
const ELIG_RANK = { uncertain: 4, not_eligible: 4, identity_only: 3, market_only: 2, bulk_safe: 1 }
const direction = { restrictive: 0, upgrade: 0, same: 0 }
const bucket = {}
const riskBucket = {}

for (const r of corrections) {
  const prevRank = ELIG_RANK[r.current_eligibility] ?? 5
  const nextRank = ELIG_RANK[r.recommended_eligibility] ?? 5
  if (nextRank > prevRank) direction.restrictive++
  else if (nextRank < prevRank) direction.upgrade++
  else direction.same++
  const k = `${r.current_eligibility ?? 'null'} → ${r.recommended_eligibility ?? 'null'}`
  bucket[k] = (bucket[k] || 0) + 1
  const kR = `${r.risk_class.padEnd(26)} · ${k}`
  riskBucket[kR] = (riskBucket[kR] || 0) + 1
}

console.log('\n  Change direction tallies:')
console.log(`    MORE restrictive:  ${direction.restrictive}`)
console.log(`    LESS restrictive:  ${direction.upgrade}`)
console.log(`    same rank:         ${direction.same}`)

console.log('\n  Corrections by direction:')
for (const [k, v] of Object.entries(bucket).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(44)} ${v}`)

console.log('\n  Corrections by risk × direction:')
for (const [k, v] of Object.entries(riskBucket).sort((a, b) => b[1] - a[1])) console.log(`    ${k} → ${v}`)

console.log('\n[2/5] computing before/after eligibility totals…')
const mappingsNow = await fetchAll('pokemon_tcg_mappings', 'id,pricing_eligibility')
const before = {}
for (const m of mappingsNow) before[m.pricing_eligibility || 'null'] = (before[m.pricing_eligibility || 'null'] || 0) + 1
const after = { ...before }
for (const r of corrections) {
  after[r.current_eligibility || 'null'] = (after[r.current_eligibility || 'null'] || 0) - 1
  after[r.recommended_eligibility || 'null'] = (after[r.recommended_eligibility || 'null'] || 0) + 1
}
console.log(`\n  ${'eligibility'.padEnd(16)} ${'BEFORE'.padStart(8)}   ${'AFTER'.padStart(8)}   ${'Δ'.padStart(8)}`)
for (const k of ['bulk_safe', 'market_only', 'identity_only', 'not_eligible', 'uncertain', 'null']) {
  if ((before[k] || 0) === 0 && (after[k] || 0) === 0) continue
  const b = before[k] || 0
  const a = after[k] || 0
  const d = a - b
  console.log(`  ${k.padEnd(16)} ${String(b).padStart(8)}   ${String(a).padStart(8)}   ${(d > 0 ? '+' + d : String(d)).padStart(8)}`)
}
console.log(`  ${'TOTAL'.padEnd(16)} ${String(mappingsNow.length).padStart(8)}   ${String(mappingsNow.length).padStart(8)}      0`)

const dryRunSnapshot = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? 'applied' : 'dry_run',
  corrections_total: corrections.length,
  direction, bucket, risk_bucket: riskBucket,
  before, after,
}
writeFileSync('scripts/_pp-tcg-match-qa/dry-run-corrections-final.json', JSON.stringify(dryRunSnapshot, null, 2))
console.log('\n  snapshot written → scripts/_pp-tcg-match-qa/dry-run-corrections-final.json')

if (!APPLY) {
  console.log('\n[dry-run] no writes. Re-run with --apply to execute.\n')
  process.exit(0)
}

// Guard: fail closed if ANY correction is non-restrictive (upgrade)
if (direction.upgrade > 0) {
  console.error(`\n[FAIL] ${direction.upgrade} corrections are LESS restrictive — refusing to apply.`)
  console.error('       Review scripts/_pp-tcg-match-qa/dry-run-corrections-final.json first.\n')
  process.exit(1)
}

// ----------- APPLY -----------
console.log('\n[3/5] registering run_id in pokemon_tcg_qa_correction_runs…')
const runId = EXPLICIT_RUN_ID || `qa-correction-${new Date().toISOString().replace(/[:.]/g, '-')}`

const existing = await sb.from('pokemon_tcg_qa_correction_runs').select('*').eq('run_id', runId).maybeSingle()
if (!existing.data) {
  const { error } = await sb.from('pokemon_tcg_qa_correction_runs').insert({
    run_id: runId,
    status: 'in_progress',
    corrections_total: corrections.length,
    initiated_by: 'automation:pp-tcg-match-qa-08',
    dry_run_snapshot: dryRunSnapshot,
  })
  if (error) throw new Error(`register run: ${error.message}`)
  console.log(`     run_id=${runId} registered (status=in_progress)`)
} else {
  if (existing.data.status !== 'in_progress') {
    throw new Error(`run_id=${runId} already ${existing.data.status} — refuse to continue. Rollback first or pick a fresh id.`)
  }
  console.log(`     resuming run_id=${runId} (applied so far: ${existing.data.corrections_applied})`)
}

console.log('\n[4/5] applying batches via RPC…')
let totalApplied = 0
for (;;) {
  const { data, error } = await sb.rpc('apply_pokemon_tcg_qa_correction_batch', {
    p_run_id: runId,
    p_batch_size: BATCH_SIZE,
  })
  if (error) {
    console.error(`\n[ERROR] RPC failed: ${error.message}`)
    console.error(`        Run ${runId} stays in_progress. Re-run with --apply --run ${runId} to resume.`)
    process.exit(1)
  }
  const [{ applied, remaining }] = data
  totalApplied += applied
  console.log(`     batch applied=${applied} total_applied=${totalApplied} remaining=${remaining}`)
  if (remaining === 0 || applied === 0) break
}

console.log('\n[5/5] verifying run completion…')
const { data: final } = await sb.from('pokemon_tcg_qa_correction_runs').select('*').eq('run_id', runId).single()
console.log(`     status=${final.status}  applied=${final.corrections_applied}  total=${final.corrections_total}`)

console.log(`\n[done] run_id=${runId}`)
console.log(`       to rollback: node scripts/pp-tcg-match-qa-08-apply-corrections.mjs --rollback ${runId}`)
