// PP-TCG-QA-FINAL post-apply verification.
//
// Checks:
//   1. run row status=completed with applied=total
//   2. Audit coverage: every eligibility change has a matching audit row for this run_id
//   3. Final mapping totals match dry-run predictions
//   4. No stale bulk_safe anywhere QA says otherwise
//   5. Zero less-restrictive moves at the (per-mapping) level
//   6. Effective-eligibility view agrees with mapping column for every row
//   7. Top 831 GSC cards cohort breakdown

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const RUN_ID = process.argv[2] || 'qa-correction-2026-10-18T19-31-24-726Z'

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
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

const EXPECTED = {
  bulk_safe: 8973,
  market_only: 27997,
  identity_only: 205,
  not_eligible: 22176,
  uncertain: 1338,
}

const report = { run_id: RUN_ID, checks: {}, pass: true }

// -------- Check 1: run row --------
console.log(`[1] run row status for ${RUN_ID}…`)
const { data: run } = await sb.from('pokemon_tcg_qa_correction_runs').select('*').eq('run_id', RUN_ID).single()
console.log(`    status=${run.status}  applied=${run.corrections_applied}  total=${run.corrections_total}`)
console.log(`    started=${run.started_at}  completed=${run.completed_at}`)
report.checks.run_status = {
  pass: run.status === 'completed' && run.corrections_applied === run.corrections_total,
  run,
}
if (!report.checks.run_status.pass) report.pass = false

// -------- Check 2: audit coverage --------
console.log(`\n[2] audit coverage for run_id ${RUN_ID}…`)
let auditCount = 0
let from = 0
while (true) {
  const { data, error } = await sb.from('pokemon_tcg_mapping_audit')
    .select('mapping_id', { count: 'exact' })
    .eq('action', 'qa_eligibility_correction')
    .filter('metadata->>run_id', 'eq', RUN_ID)
    .range(from, from + 999)
  if (error) throw new Error(error.message)
  auditCount += (data || []).length
  if (!data || data.length < 1000) break
  from += 1000
}
console.log(`    audit rows for this run: ${auditCount}`)
report.checks.audit_coverage = {
  pass: auditCount === run.corrections_applied,
  audit_rows: auditCount,
  expected: run.corrections_applied,
}
if (!report.checks.audit_coverage.pass) report.pass = false

// -------- Check 3: final mapping totals --------
console.log(`\n[3] final mapping eligibility totals…`)
const mappings = await fetchAll('pokemon_tcg_mappings', 'id,pricing_eligibility,review_status')
const actual = {}
for (const m of mappings) actual[m.pricing_eligibility || 'null'] = (actual[m.pricing_eligibility || 'null'] || 0) + 1
console.log(`    ${'eligibility'.padEnd(16)} ${'expected'.padStart(10)} ${'actual'.padStart(10)}  match`)
let allMatch = true
for (const [k, expected] of Object.entries(EXPECTED)) {
  const a = actual[k] || 0
  const ok = a === expected
  if (!ok) allMatch = false
  console.log(`    ${k.padEnd(16)} ${String(expected).padStart(10)} ${String(a).padStart(10)}  ${ok ? '✓' : '✗ MISMATCH'}`)
}
report.checks.mapping_totals = { pass: allMatch, expected: EXPECTED, actual }
if (!allMatch) report.pass = false

// -------- Check 4: no stale bulk_safe where QA says otherwise --------
console.log(`\n[4] stale bulk_safe check…`)
const qa = await fetchAll('pokemon_tcg_mapping_qa', 'mapping_id,recommended_pricing_eligibility,risk_class')
const qaByMappingId = new Map(qa.map(q => [q.mapping_id, q]))

const RANK = { uncertain: 4, not_eligible: 4, identity_only: 3, market_only: 2, bulk_safe: 1 }
let staleCount = 0
let staleSamples = []
for (const m of mappings) {
  const q = qaByMappingId.get(m.id)
  if (!q) continue
  const currentRank = RANK[m.pricing_eligibility] ?? 4
  const recommendedRank = RANK[q.recommended_pricing_eligibility] ?? 4
  if (recommendedRank > currentRank) {
    staleCount++
    if (staleSamples.length < 10) staleSamples.push({ mapping_id: m.id, current: m.pricing_eligibility, recommended: q.recommended_pricing_eligibility, risk_class: q.risk_class })
  }
}
console.log(`    stale permissive (current less restrictive than QA recommendation): ${staleCount}`)
report.checks.stale_bulk_safe = { pass: staleCount === 0, stale_count: staleCount, samples: staleSamples }
if (staleCount > 0) report.pass = false

// -------- Check 5: audit metadata consistency --------
console.log(`\n[5] audit metadata consistency…`)
const audits = []
from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_mapping_audit')
    .select('mapping_id,metadata,action')
    .eq('action', 'qa_eligibility_correction')
    .filter('metadata->>run_id', 'eq', RUN_ID)
    .range(from, from + 999)
  if (!data || data.length === 0) break
  audits.push(...data)
  if (data.length < 1000) break
  from += 1000
}

// Check each audit's "to_eligibility" matches current mapping pricing_eligibility
const mapById = new Map(mappings.map(m => [m.id, m]))
let auditMismatch = 0
let auditMismatchSamples = []
let auditRankIssues = 0
for (const a of audits) {
  const m = mapById.get(a.mapping_id)
  if (!m) continue
  const toElig = a.metadata?.to_eligibility
  if (toElig && m.pricing_eligibility !== toElig) {
    auditMismatch++
    if (auditMismatchSamples.length < 5) auditMismatchSamples.push({ mapping_id: a.mapping_id, audit_to: toElig, current: m.pricing_eligibility })
  }
  const fromRank = RANK[a.metadata?.from_eligibility] ?? 4
  const toRank = RANK[toElig] ?? 4
  if (toRank < fromRank) auditRankIssues++
}
console.log(`    audits where to_eligibility ≠ current mapping: ${auditMismatch}`)
console.log(`    audits that moved to a LESS restrictive rank:   ${auditRankIssues}`)
report.checks.audit_consistency = {
  pass: auditMismatch === 0 && auditRankIssues === 0,
  audit_to_vs_current_mismatch: auditMismatch,
  audit_rank_regressions: auditRankIssues,
  samples: auditMismatchSamples,
}
if (!report.checks.audit_consistency.pass) report.pass = false

// -------- Check 6: effective view agreement --------
console.log(`\n[6] effective view agreement…`)
const effective = await fetchAll('v_pokemon_tcg_effective_eligibility', 'mapping_id,matcher_eligibility,qa_recommended_eligibility,effective_eligibility')
let effDisagreement = 0
let effSamples = []
for (const e of effective) {
  const m = mapById.get(e.mapping_id)
  if (!m) continue
  if (e.effective_eligibility !== m.pricing_eligibility) {
    effDisagreement++
    if (effSamples.length < 5) effSamples.push({ mapping_id: e.mapping_id, effective: e.effective_eligibility, mapping: m.pricing_eligibility, qa: e.qa_recommended_eligibility })
  }
}
console.log(`    rows where effective ≠ current mapping: ${effDisagreement}`)
report.checks.effective_agreement = { pass: effDisagreement === 0, disagreement: effDisagreement, samples: effSamples }
if (!report.checks.effective_agreement.pass) report.pass = false

// -------- Check 7: top-831 GSC cohort --------
console.log(`\n[7] top 831 GSC traffic cohort…`)
const { data: topMappings, error: topErr } = await sb.from('pokemon_tcg_mappings')
  .select('id,pp_card_slug,pricing_eligibility,review_status,confidence,commercial_rank')
  .not('commercial_rank', 'is', null)
  .lte('commercial_rank', 831)
  .order('commercial_rank', { ascending: true })
if (topErr) throw new Error(topErr.message)

const gscCohort = { by_eligibility: {}, by_risk: {}, identity_safe_count: 0, approvable_count: 0, quarantined_count: 0, graded_eligible_count: 0, market_eligible_count: 0, image_only_count: 0 }
for (const m of (topMappings || [])) {
  const q = qaByMappingId.get(m.id)
  gscCohort.by_eligibility[m.pricing_eligibility || 'null'] = (gscCohort.by_eligibility[m.pricing_eligibility || 'null'] || 0) + 1
  if (q) {
    gscCohort.by_risk[q.risk_class] = (gscCohort.by_risk[q.risk_class] || 0) + 1
    if (['catalogue_corroborated', 'pricing_restriction', 'internally_consistent'].includes(q.risk_class)) {
      gscCohort.identity_safe_count++
      if (m.confidence === 'verified' && ['pending_review', 'unmatched'].includes(m.review_status)) {
        gscCohort.approvable_count++
      }
    } else {
      gscCohort.quarantined_count++
    }
  }
  if (m.pricing_eligibility === 'bulk_safe') gscCohort.graded_eligible_count++
  if (m.pricing_eligibility === 'bulk_safe' || m.pricing_eligibility === 'market_only') gscCohort.market_eligible_count++
  if (m.pricing_eligibility === 'identity_only') gscCohort.image_only_count++
}

console.log(`    top 831 GSC mappings found: ${topMappings?.length ?? 0}`)
console.log(`    by current pricing_eligibility:`)
for (const [k, v] of Object.entries(gscCohort.by_eligibility).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(16)} ${v}`)
console.log(`    by risk class:`)
for (const [k, v] of Object.entries(gscCohort.by_risk).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(26)} ${v}`)
console.log(`    identity-safe:       ${gscCohort.identity_safe_count}`)
console.log(`    approvable:          ${gscCohort.approvable_count}`)
console.log(`    quarantined:         ${gscCohort.quarantined_count}`)
console.log(`    graded-eligible:     ${gscCohort.graded_eligible_count}`)
console.log(`    market-eligible:     ${gscCohort.market_eligible_count}`)
console.log(`    image-only:          ${gscCohort.image_only_count}`)
report.checks.top_831_gsc = { count: topMappings?.length ?? 0, ...gscCohort }

// -------- Overall --------
console.log(`\n=== OVERALL: ${report.pass ? '✓ PASS' : '✗ FAIL'} ===`)
writeFileSync('scripts/_pp-tcg-match-qa/post-apply-verification.json', JSON.stringify(report, null, 2))
console.log('report written → scripts/_pp-tcg-match-qa/post-apply-verification.json')
