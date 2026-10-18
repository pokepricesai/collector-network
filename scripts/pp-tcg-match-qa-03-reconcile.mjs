// PP-TCG-MATCH reconciliation — before writing anything, pull
// the real numbers for each of the operator's 8 points so the
// output doc is based on actual DB state, not inferred counts.

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

async function countTable(table, filters = (q) => q) {
  const { count, error } = await filters(sb.from(table).select('*', { count: 'exact', head: true }))
  if (error) throw new Error(error.message)
  return count ?? 0
}

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

const report = {}

// ---- POINT 1: Row totals ----
console.log('[1] totals…')
report.mappings_total = await countTable('pokemon_tcg_mappings')
report.qa_total = await countTable('pokemon_tcg_mapping_qa')
report.qa_by_risk = {}
for (const c of ['verified_independent', 'internally_consistent', 'ambiguous_variant', 'conflicting_identity', 'pricing_restriction', 'unverifiable']) {
  report.qa_by_risk[c] = await countTable('pokemon_tcg_mapping_qa', q => q.eq('risk_class', c))
}
report.qa_classes_sum = Object.values(report.qa_by_risk).reduce((a, b) => a + b, 0)
report.unaudited_count = report.mappings_total - report.qa_total

// ---- POINT 2: bulk_safe downgrade reconciliation ----
console.log('[2] bulk_safe downgrade reconciliation…')
const qaRows = await fetchAll(
  'pokemon_tcg_mapping_qa',
  'mapping_id,risk_class,prior_pricing_eligibility,recommended_pricing_eligibility',
)
report.cross_tab_prior_x_recommended = {}
report.cross_tab_prior_x_risk = {}
for (const r of qaRows) {
  const p = r.prior_pricing_eligibility || 'null'
  const rec = r.recommended_pricing_eligibility || 'null'
  const risk = r.risk_class
  const k1 = `${p} → ${rec}`
  report.cross_tab_prior_x_recommended[k1] = (report.cross_tab_prior_x_recommended[k1] || 0) + 1
  const k2 = `${p} · ${risk}`
  report.cross_tab_prior_x_risk[k2] = (report.cross_tab_prior_x_risk[k2] || 0) + 1
}

// Specifically: how many bulk_safe downgrades vs how many pricing_restriction
report.bulk_safe_downgrades = {
  bulk_safe_to_market_only: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.recommended_pricing_eligibility === 'market_only').length,
  bulk_safe_to_identity_only: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.recommended_pricing_eligibility === 'identity_only').length,
  bulk_safe_stays_bulk_safe: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.recommended_pricing_eligibility === 'bulk_safe').length,
  bulk_safe_in_pricing_restriction: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.risk_class === 'pricing_restriction').length,
  bulk_safe_in_ambiguous: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.risk_class === 'ambiguous_variant').length,
  bulk_safe_in_verified: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.risk_class === 'verified_independent').length,
  bulk_safe_in_conflicting: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.risk_class === 'conflicting_identity').length,
  bulk_safe_in_unverifiable: qaRows.filter(r => r.prior_pricing_eligibility === 'bulk_safe' && r.risk_class === 'unverifiable').length,
}

// ---- POINT 3: What's in the 23,797 bulk_approve_candidates ----
console.log('[3] bulk_approve_candidates breakdown…')
const candidates = await fetchAll('v_pokemon_tcg_bulk_approve_candidates', 'mapping_id,pricing_eligibility')
report.bulk_approve_candidates_total = candidates.length
report.bulk_approve_candidates_by_eligibility = {}
for (const r of candidates) {
  const k = r.pricing_eligibility || 'null'
  report.bulk_approve_candidates_by_eligibility[k] = (report.bulk_approve_candidates_by_eligibility[k] || 0) + 1
}

// The corrections view
const corrections = await fetchAll('v_pokemon_tcg_pricing_eligibility_corrections', 'mapping_id,current_eligibility,recommended_eligibility')
report.corrections_total = corrections.length
report.corrections_by_direction = {}
for (const r of corrections) {
  const k = `${r.current_eligibility || 'null'} → ${r.recommended_eligibility || 'null'}`
  report.corrections_by_direction[k] = (report.corrections_by_direction[k] || 0) + 1
}

// ---- POINT 4: identity-safe vs pricing-eligible ----
console.log('[4] identity vs pricing split…')
// Identity-safe = passes name+number+set+language exact match checks regardless of eligibility
const identityCheck = await fetchAll('pokemon_tcg_mapping_qa', 'name_exact_match,number_exact_match,set_match,language_match,risk_class,recommended_pricing_eligibility')
report.identity_safe_total = identityCheck.filter(r =>
  r.name_exact_match && r.number_exact_match && r.set_match && r.language_match
).length
report.identity_safe_in_verified = identityCheck.filter(r =>
  r.name_exact_match && r.number_exact_match && r.set_match && r.language_match && r.risk_class === 'verified_independent'
).length

// Eligible for aggregate graded = identity-safe AND recommended=bulk_safe
report.graded_eligible_total = identityCheck.filter(r =>
  r.name_exact_match && r.number_exact_match && r.set_match && r.language_match && r.recommended_pricing_eligibility === 'bulk_safe'
).length

writeFileSync('scripts/_pp-tcg-match-qa/reconciliation.json', JSON.stringify(report, null, 2))

console.log('\n=== POINT 1: Totals ===')
console.log(`  mappings total:      ${report.mappings_total}`)
console.log(`  qa rows total:       ${report.qa_total}`)
console.log(`  qa classes sum:      ${report.qa_classes_sum}`)
console.log(`  unaudited:           ${report.unaudited_count}`)
console.log('  by risk class:')
for (const [k, v] of Object.entries(report.qa_by_risk)) console.log(`    ${k.padEnd(28)} ${v}`)

console.log('\n=== POINT 2: bulk_safe cross-tab ===')
for (const [k, v] of Object.entries(report.cross_tab_prior_x_recommended).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(42)} ${v}`)
}
console.log('\n  bulk_safe by risk class:')
for (const [k, v] of Object.entries(report.bulk_safe_downgrades)) console.log(`    ${k.padEnd(38)} ${v}`)

console.log('\n=== POINT 3: bulk_approve_candidates ===')
console.log(`  total:                      ${report.bulk_approve_candidates_total}`)
console.log('  by pricing_eligibility:')
for (const [k, v] of Object.entries(report.bulk_approve_candidates_by_eligibility)) console.log(`    ${k.padEnd(18)} ${v}`)
console.log(`  corrections view total:    ${report.corrections_total}`)
console.log('  corrections by direction:')
for (const [k, v] of Object.entries(report.corrections_by_direction).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(42)} ${v}`)

console.log('\n=== POINT 4: Identity-safe vs graded-eligible ===')
console.log(`  identity_safe (all 4 fields match):       ${report.identity_safe_total}`)
console.log(`  identity_safe in verified_independent:    ${report.identity_safe_in_verified}`)
console.log(`  graded_eligible (identity_safe + rec=bulk_safe): ${report.graded_eligible_total}`)

console.log('\n[done]')
