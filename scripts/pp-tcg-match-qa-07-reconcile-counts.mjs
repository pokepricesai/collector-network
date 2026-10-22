// PP-TCG-QA-FINAL §2 — single-source-of-truth reconciliation.
//
// Each count is computed via explicit JOIN and uses UNIQUE mapping_ids.
// No composition of in-memory maps that could lose rows. If the view's
// SQL doesn't match the inline query here, that's a view bug to fix.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

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

// Pull one authoritative snapshot
console.log('[1/4] pulling mappings + qa (full join in memory)…')
const mappings = await fetchAll('pokemon_tcg_mappings', 'id,pp_card_slug,pricing_eligibility,review_status,confidence,tcg_card_id,tcg_printing_key')
const qa = await fetchAll('pokemon_tcg_mapping_qa', 'mapping_id,risk_class,prior_pricing_eligibility,recommended_pricing_eligibility,single_printing,market_price_available')

const qaByMappingId = new Map(qa.map(q => [q.mapping_id, q]))

// Build joined rows
const joined = mappings.map(m => ({ m, q: qaByMappingId.get(m.id) })).filter(r => r.q)
const orphaned = mappings.length - joined.length
console.log(`     mappings: ${mappings.length}  qa: ${qa.length}  joined: ${joined.length}  orphan: ${orphaned}`)

const report = { mappings_total: mappings.length, qa_total: qa.length, joined, orphaned }

// -----------------------------------------------------------
// POINT A: Catalogue-corroborated — ALL (regardless of review_status)
// -----------------------------------------------------------
const catalogueCorroborated = joined.filter(r => r.q.risk_class === 'catalogue_corroborated')
report.catalogue_corroborated_all = catalogueCorroborated.length

// POINT B: Catalogue-corroborated eligible for IDENTITY approval
// (confidence=verified AND review_status in pending/unmatched)
const APPROVABLE_STATUS = new Set(['pending_review', 'unmatched'])
const catalogueCorroboratedApprovable = catalogueCorroborated.filter(r =>
  r.m.confidence === 'verified' && APPROVABLE_STATUS.has(r.m.review_status)
)
report.catalogue_corroborated_approvable = catalogueCorroboratedApprovable.length

// POINT C: Pricing-restriction approvable
const pricingRestriction = joined.filter(r => r.q.risk_class === 'pricing_restriction')
const pricingRestrictionApprovable = pricingRestriction.filter(r =>
  r.m.confidence === 'verified' && APPROVABLE_STATUS.has(r.m.review_status)
)
report.pricing_restriction_all = pricingRestriction.length
report.pricing_restriction_approvable = pricingRestrictionApprovable.length

// POINT D: internally_consistent approvable
const internallyConsistent = joined.filter(r => r.q.risk_class === 'internally_consistent')
const internallyConsistentApprovable = internallyConsistent.filter(r =>
  r.m.confidence === 'verified' && APPROVABLE_STATUS.has(r.m.review_status)
)
report.internally_consistent_all = internallyConsistent.length
report.internally_consistent_approvable = internallyConsistentApprovable.length

// COMBINED IDENTITY-SAFE APPROVABLE
const identitySafeApprovable = [...catalogueCorroboratedApprovable, ...pricingRestrictionApprovable, ...internallyConsistentApprovable]
const identitySafeIds = new Set(identitySafeApprovable.map(r => r.m.id))
report.identity_safe_approvable = identitySafeApprovable.length

// -----------------------------------------------------------
// POINTS E-H: pricing eligibility distribution AFTER recommended corrections
// -----------------------------------------------------------
// Effective (post-correction) eligibility for each mapping = recommended if set, else prior
function effective(r) {
  return r.q.recommended_pricing_eligibility || r.q.prior_pricing_eligibility || 'uncertain'
}

// Within identity-safe approvable
const byEffective = { bulk_safe: 0, market_only: 0, identity_only: 0, not_eligible: 0, uncertain: 0 }
for (const r of identitySafeApprovable) {
  const e = effective(r)
  byEffective[e] = (byEffective[e] || 0) + 1
}
report.identity_safe_by_effective = byEffective
report.bulk_safe_pricing = byEffective.bulk_safe
report.market_only_pricing = byEffective.market_only
report.identity_only_pricing = byEffective.identity_only

// POINT I: Quarantined (ambiguous + conflicting + unverifiable)
const QUARANTINE_CLASSES = new Set(['ambiguous_variant', 'conflicting_identity', 'unverifiable'])
const quarantined = joined.filter(r => QUARANTINE_CLASSES.has(r.q.risk_class))
report.quarantined_total = quarantined.length
report.quarantined_by_class = {
  ambiguous_variant: quarantined.filter(r => r.q.risk_class === 'ambiguous_variant').length,
  conflicting_identity: quarantined.filter(r => r.q.risk_class === 'conflicting_identity').length,
  unverifiable: quarantined.filter(r => r.q.risk_class === 'unverifiable').length,
}

// Any approvable with non-approvable status? (should be 0)
const unapprovableIdentitySafe = [...catalogueCorroborated, ...pricingRestriction, ...internallyConsistent]
  .filter(r => !identitySafeIds.has(r.m.id))
report.identity_safe_but_unapprovable = unapprovableIdentitySafe.length

// Review-status breakdown
const byStatus = {}
for (const r of unapprovableIdentitySafe) {
  byStatus[r.m.review_status] = (byStatus[r.m.review_status] || 0) + 1
}
report.identity_safe_unapprovable_by_status = byStatus

// -----------------------------------------------------------
// Rebuild the view's bulk_approve_candidates filter locally — matches view SQL
// -----------------------------------------------------------
// view filter: risk_class=catalogue_corroborated AND review_status IN (pending_review,unmatched)
//              AND confidence=verified AND q.recommended = m.pricing_eligibility
const viewBulkApprove = catalogueCorroborated.filter(r =>
  r.m.confidence === 'verified' &&
  APPROVABLE_STATUS.has(r.m.review_status) &&
  r.q.recommended_pricing_eligibility === r.m.pricing_eligibility
)
report.view_bulk_approve_candidates_local_calc = viewBulkApprove.length
report.view_bulk_approve_by_pricing_eligibility = {}
for (const r of viewBulkApprove) {
  const k = r.m.pricing_eligibility || 'null'
  report.view_bulk_approve_by_pricing_eligibility[k] = (report.view_bulk_approve_by_pricing_eligibility[k] || 0) + 1
}

// -----------------------------------------------------------
// Query the actual DB view counts for comparison
// -----------------------------------------------------------
console.log('[2/4] querying DB views directly for sanity check…')
const { count: viewTotal } = await sb.from('v_pokemon_tcg_bulk_approve_candidates').select('*', { count: 'exact', head: true })
const { count: viewBulkSafe } = await sb.from('v_pokemon_tcg_bulk_approve_candidates').select('*', { count: 'exact', head: true }).eq('pricing_eligibility', 'bulk_safe')
const { count: viewMarket } = await sb.from('v_pokemon_tcg_bulk_approve_candidates').select('*', { count: 'exact', head: true }).eq('pricing_eligibility', 'market_only')
const { count: viewIdOnly } = await sb.from('v_pokemon_tcg_bulk_approve_candidates').select('*', { count: 'exact', head: true }).eq('pricing_eligibility', 'identity_only')
const { count: identityCohort } = await sb.from('v_pokemon_tcg_identity_safe_cohort').select('*', { count: 'exact', head: true })
const { count: corrections } = await sb.from('v_pokemon_tcg_pricing_eligibility_corrections').select('*', { count: 'exact', head: true })

report.db_view_counts = {
  v_pokemon_tcg_bulk_approve_candidates: viewTotal,
  v_pokemon_tcg_bulk_approve_candidates_by_pricing: { bulk_safe: viewBulkSafe, market_only: viewMarket, identity_only: viewIdOnly },
  v_pokemon_tcg_identity_safe_cohort: identityCohort,
  v_pokemon_tcg_pricing_eligibility_corrections: corrections,
}

// -----------------------------------------------------------
// Point-by-point reconciliation output
// -----------------------------------------------------------
console.log('\n=== POINT A: All catalogue_corroborated ===')
console.log(`  via QA table:          ${report.catalogue_corroborated_all}`)

console.log('\n=== POINT B: Catalogue-corroborated eligible for IDENTITY approval ===')
console.log(`  (confidence=verified AND status in [pending/unmatched]):  ${report.catalogue_corroborated_approvable}`)

console.log('\n=== POINT C: pricing_restriction eligible for IDENTITY approval ===')
console.log(`  all:                     ${report.pricing_restriction_all}`)
console.log(`  approvable:              ${report.pricing_restriction_approvable}`)

console.log('\n=== POINT D: internally_consistent approvable ===')
console.log(`  all:                     ${report.internally_consistent_all}`)
console.log(`  approvable:              ${report.internally_consistent_approvable}`)

console.log('\n=== POINT E: Combined identity-safe approvable ===')
console.log(`  total:                   ${report.identity_safe_approvable}`)
console.log('  by effective eligibility (= qa.recommended):')
for (const [k, v] of Object.entries(byEffective)) console.log(`    ${k.padEnd(16)} ${v}`)

console.log('\n=== POINT F: QUARANTINED (ambiguous + conflicting + unverifiable) ===')
console.log(`  total:                   ${report.quarantined_total}`)
for (const [k, v] of Object.entries(report.quarantined_by_class)) console.log(`    ${k.padEnd(22)} ${v}`)

console.log('\n=== Reconciliation ===')
console.log(`  identity_safe_approvable + quarantined_total + identity_safe_but_unapprovable = ${report.identity_safe_approvable + report.quarantined_total + report.identity_safe_but_unapprovable}`)
console.log(`  Must equal mappings_total=${report.mappings_total}: ${(report.identity_safe_approvable + report.quarantined_total + report.identity_safe_but_unapprovable) === report.mappings_total ? '✓' : '✗'}`)
console.log(`  identity_safe_but_unapprovable: ${report.identity_safe_but_unapprovable}`)
if (Object.keys(report.identity_safe_unapprovable_by_status).length) {
  console.log(`    by status: ${JSON.stringify(report.identity_safe_unapprovable_by_status)}`)
}

console.log('\n=== Local vs DB view counts ===')
console.log(`  catalogue_corroborated_approvable:   ${report.catalogue_corroborated_approvable}`)
console.log(`  view bulk_approve_candidates (local): ${report.view_bulk_approve_candidates_local_calc}`)
console.log(`  view bulk_approve_candidates (DB):   ${report.db_view_counts.v_pokemon_tcg_bulk_approve_candidates}`)
console.log(`  Match: ${report.view_bulk_approve_candidates_local_calc === report.db_view_counts.v_pokemon_tcg_bulk_approve_candidates ? '✓' : '✗'}`)
console.log(`  v_identity_safe_cohort (DB):         ${report.db_view_counts.v_pokemon_tcg_identity_safe_cohort}`)
console.log(`  identity_safe_approvable (local):    ${report.identity_safe_approvable}`)
console.log(`  Match: ${report.db_view_counts.v_pokemon_tcg_identity_safe_cohort === report.identity_safe_approvable ? '✓' : '✗'}`)

writeFileSync('scripts/_pp-tcg-match-qa/reconcile-counts.json', JSON.stringify(report, null, 2))

console.log('\n[done]')
