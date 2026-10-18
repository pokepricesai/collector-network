// PP-TCG-APPROVAL — identity bulk-approval driver.
//
// Approves `review_status='approved'` for mappings in
// v_pokemon_tcg_identity_safe_cohort. Does NOT touch
// pricing_eligibility — that is already set to the QA
// recommendation (per the earlier correction run) and remains the
// public adapter's enforcement surface.
//
// Usage:
//   node scripts/pp-tcg-match-qa-11-approve-identities.mjs
//     → dry-run: shows total + per-eligibility + per-risk breakdown + 20-sample
//
//   node scripts/pp-tcg-match-qa-11-approve-identities.mjs --apply
//     → registers run_id, applies 500-row batches via RPC
//
//   node scripts/pp-tcg-match-qa-11-approve-identities.mjs --apply --run <id>
//     → resume a previously-started run after a crash
//
//   node scripts/pp-tcg-match-qa-11-approve-identities.mjs --rollback <run_id>
//     → reverse the entire run

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

async function fetchAll(table, select, filters = (q) => q, orderCol = 'mapping_id') {
  // Postgres pagination needs a stable ORDER BY — otherwise .range() can
  // return the same row on multiple pages and skip others.
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filters(sb.from(table).select(select).order(orderCol, { ascending: true })).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

if (ROLLBACK_RUN_ID) {
  console.log(`\n=== ROLLBACK ${ROLLBACK_RUN_ID} ===\n`)
  const { data, error } = await sb.rpc('rollback_pokemon_tcg_identity_approval_run', { p_run_id: ROLLBACK_RUN_ID })
  if (error) throw new Error(`rollback: ${error.message}`)
  console.log(`  reverted ${data} mapping(s) to prior review_status`)
  process.exit(0)
}

console.log(`\n=== PP-TCG-APPROVAL · ${APPLY ? 'APPLY' : 'DRY-RUN'} ===\n`)

console.log('[1/4] fetching identity-safe cohort…')
const cohort = await fetchAll('v_pokemon_tcg_identity_safe_cohort',
  'mapping_id,pp_card_slug,pp_card_name,tcg_card_id,tcg_printing_key,matcher_eligibility,recommended_eligibility,risk_class')
console.log(`     ${cohort.length} mappings in cohort`)

// Uniqueness
const uniqueIds = new Set(cohort.map(c => c.mapping_id))
if (uniqueIds.size !== cohort.length) {
  console.error(`[FAIL] duplicate mapping_ids in cohort: ${cohort.length - uniqueIds.size} duplicates`)
  process.exit(1)
}
console.log(`     ${uniqueIds.size} unique mapping_ids (no duplicates)`)

// Breakdown by (risk class, matcher eligibility, QA recommended)
console.log('\n[2/4] breakdown…')
const byRisk = {}
const byEligibility = {}
const byRecommended = {}
for (const c of cohort) {
  byRisk[c.risk_class] = (byRisk[c.risk_class] || 0) + 1
  byEligibility[c.matcher_eligibility || 'null'] = (byEligibility[c.matcher_eligibility || 'null'] || 0) + 1
  byRecommended[c.recommended_eligibility || 'null'] = (byRecommended[c.recommended_eligibility || 'null'] || 0) + 1
}
console.log('  by risk class:')
for (const [k, v] of Object.entries(byRisk).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(26)} ${v}`)
console.log('  by matcher_eligibility (current):')
for (const [k, v] of Object.entries(byEligibility).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(16)} ${v}`)
console.log('  by qa.recommended_eligibility:')
for (const [k, v] of Object.entries(byRecommended).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(16)} ${v}`)

// Verify current review_status for each
console.log('\n[3/4] current review_status + confidence verification (via join)…')
const { data: statuses } = await sb.from('pokemon_tcg_mappings').select('id,review_status,confidence,tcg_card_id,tcg_printing_key').in('id', cohort.slice(0, 1).map(c => c.mapping_id))
// pagination for 37k rows via batched IN
const statusMap = new Map()
for (let i = 0; i < cohort.length; i += 500) {
  const chunk = cohort.slice(i, i + 500)
  const { data } = await sb.from('pokemon_tcg_mappings')
    .select('id,review_status,confidence')
    .in('id', chunk.map(c => c.mapping_id))
  for (const r of (data || [])) statusMap.set(r.id, r)
}
const invalidStatus = []
const invalidConfidence = []
const alreadyApproved = []
for (const c of cohort) {
  const s = statusMap.get(c.mapping_id)
  if (!s) continue
  if (s.review_status === 'approved') alreadyApproved.push(c.mapping_id)
  else if (!['pending_review', 'unmatched'].includes(s.review_status)) invalidStatus.push({ mapping_id: c.mapping_id, review_status: s.review_status })
  if (s.confidence !== 'verified') invalidConfidence.push({ mapping_id: c.mapping_id, confidence: s.confidence })
}
console.log(`     already approved in cohort:   ${alreadyApproved.length}`)
console.log(`     non-approvable review_status: ${invalidStatus.length}`)
console.log(`     non-verified confidence:      ${invalidConfidence.length}`)

if (invalidStatus.length > 0 || invalidConfidence.length > 0) {
  console.error('[FAIL] cohort includes mappings outside the approve-safe filter')
  process.exit(1)
}

// 20-sample for operator review
console.log('\n[4/4] 20 random samples for operator review…')
const samples = cohort.sort(() => Math.random() - 0.5).slice(0, 20)
for (const s of samples) {
  console.log(`  slug=${s.pp_card_slug.padEnd(12)} name="${s.pp_card_name?.slice(0, 42).padEnd(42) ?? '—'.padEnd(42)}"  risk=${s.risk_class.padEnd(22)} elig=${s.matcher_eligibility}`)
}

const snapshot = {
  generated_at: new Date().toISOString(),
  mode: APPLY ? 'applied' : 'dry_run',
  cohort_total: cohort.length,
  unique_mapping_ids: uniqueIds.size,
  by_risk: byRisk,
  by_matcher_eligibility: byEligibility,
  by_recommended_eligibility: byRecommended,
  already_approved: alreadyApproved.length,
  invalid_status_count: invalidStatus.length,
  invalid_confidence_count: invalidConfidence.length,
}
writeFileSync('scripts/_pp-tcg-match-qa/dry-run-approvals.json', JSON.stringify(snapshot, null, 2))
console.log('\n  snapshot → scripts/_pp-tcg-match-qa/dry-run-approvals.json')

if (!APPLY) {
  console.log(`\n[dry-run] no writes. ${cohort.length - alreadyApproved.length} new approvals would be executed with --apply.\n`)
  process.exit(0)
}

// APPLY
console.log('\n[register] creating pokemon_tcg_identity_approval_runs row…')
const runId = EXPLICIT_RUN_ID || `qa-approval-${new Date().toISOString().replace(/[:.]/g, '-')}`
const existing = await sb.from('pokemon_tcg_identity_approval_runs').select('*').eq('run_id', runId).maybeSingle()
if (!existing.data) {
  const { error } = await sb.from('pokemon_tcg_identity_approval_runs').insert({
    run_id: runId,
    status: 'in_progress',
    approvals_total: cohort.length - alreadyApproved.length,
    initiated_by: 'automation:pp-tcg-match-qa-11',
    dry_run_snapshot: snapshot,
  })
  if (error) throw new Error(`register run: ${error.message}`)
  console.log(`     run_id=${runId} registered`)
} else {
  if (existing.data.status !== 'in_progress') throw new Error(`run_id=${runId} already ${existing.data.status}`)
  console.log(`     resuming run_id=${runId} (applied so far: ${existing.data.approvals_applied})`)
}

console.log('\n[apply] processing RPC batches…')
let totalApplied = 0
for (;;) {
  const { data, error } = await sb.rpc('apply_pokemon_tcg_identity_approval_batch', {
    p_run_id: runId,
    p_batch_size: BATCH_SIZE,
  })
  if (error) {
    console.error(`[ERROR] RPC failed: ${error.message}`)
    console.error(`        Run ${runId} stays in_progress. Resume with --apply --run ${runId}.`)
    process.exit(1)
  }
  const [{ approved, remaining }] = data
  totalApplied += approved
  console.log(`     batch approved=${approved} total_applied=${totalApplied} remaining=${remaining}`)
  if (remaining === 0 || approved === 0) break
}

const { data: final } = await sb.from('pokemon_tcg_identity_approval_runs').select('*').eq('run_id', runId).single()
console.log(`\n[done] run_id=${runId}  status=${final.status}  applied=${final.approvals_applied}/${final.approvals_total}`)
console.log(`       rollback: node scripts/pp-tcg-match-qa-11-approve-identities.mjs --rollback ${runId}`)
