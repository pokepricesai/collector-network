// PP-TCG-APPROVAL-02 final reconciliation (4 items).

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

async function fetchAll(table, select, filterFn = (q) => q, orderCol = 'mapping_id') {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filterFn(sb.from(table).select(select).order(orderCol)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

// ============ ITEM 1 ============
console.log('=== ITEM 1: 37,224 cohort vs 37,231 eligible — identify the 7 ===\n')

const cohort = await fetchAll('v_pokemon_tcg_identity_safe_cohort', 'mapping_id', q => q)
const cohortIds = new Set(cohort.map(r => r.mapping_id))
console.log(`  v_pokemon_tcg_identity_safe_cohort rows: ${cohortIds.size}`)

const eligible = []
let from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_mappings')
    .select('id,review_status,confidence,pricing_eligibility')
    .in('pricing_eligibility', ['bulk_safe', 'market_only', 'identity_only'])
    .order('id')
    .range(from, from + 999)
  if (!data || !data.length) break
  eligible.push(...data)
  if (data.length < 1000) break
  from += 1000
}
console.log(`  mappings with pricing_eligibility in {bulk_safe, market_only, identity_only}: ${eligible.length}`)
console.log(`  difference: ${eligible.length - cohortIds.size}`)

const notInCohort = eligible.filter(e => !cohortIds.has(e.id))
console.log(`  ${notInCohort.length} eligible mappings NOT in identity-safe cohort:`)
for (const n of notInCohort) {
  const { data: qa } = await sb.from('pokemon_tcg_mapping_qa')
    .select('risk_class,recommended_pricing_eligibility').eq('mapping_id', n.id).maybeSingle()
  console.log(`    id=${n.id.slice(0, 8)} elig=${n.pricing_eligibility} status=${n.review_status} conf=${n.confidence} risk=${qa?.risk_class ?? 'none'}`)
}

// ============ ITEM 2 ============
console.log('\n=== ITEM 2: 831 high-traffic reconciliation ===\n')

const { data: topMappings } = await sb.from('pokemon_tcg_mappings')
  .select('id,pp_card_name,commercial_rank,pricing_eligibility,review_status,confidence,tcg_card_id')
  .not('commercial_rank', 'is', null)
  .lte('commercial_rank', 831)
  .order('commercial_rank')

const topIds = topMappings.map(t => t.id)
const qaMap = {}
for (let i = 0; i < topIds.length; i += 100) {
  const chunk = topIds.slice(i, i + 100)
  const { data: q } = await sb.from('pokemon_tcg_mapping_qa').select('mapping_id,risk_class').in('mapping_id', chunk)
  for (const r of (q || [])) qaMap[r.mapping_id] = r
}

const buckets = {
  approvable_bulk_safe: 0,
  approvable_market_only: 0,
  approvable_identity_only: 0,
  quarantined_not_eligible: 0,
  uncertain: 0,
  has_row_no_tcg_card_id: 0,
  non_approvable_eligible: 0,       // eligibility OK but confidence/status mismatch
}

for (const m of topMappings) {
  if (!m.tcg_card_id) { buckets.has_row_no_tcg_card_id++; continue }
  const isApprovable = m.confidence === 'verified' && ['pending_review','unmatched'].includes(m.review_status) && cohortIds.has(m.id)
  if (isApprovable) {
    if (m.pricing_eligibility === 'bulk_safe') buckets.approvable_bulk_safe++
    else if (m.pricing_eligibility === 'market_only') buckets.approvable_market_only++
    else if (m.pricing_eligibility === 'identity_only') buckets.approvable_identity_only++
    else buckets.non_approvable_eligible++
  } else {
    if (m.pricing_eligibility === 'uncertain') buckets.uncertain++
    else if (m.pricing_eligibility === 'not_eligible') buckets.quarantined_not_eligible++
    else buckets.non_approvable_eligible++
  }
}

const noMappingRow = 831 - topMappings.length
console.log('  mutually exclusive buckets (sum must equal 831):')
console.log(`    approvable + bulk_safe:         ${buckets.approvable_bulk_safe}`)
console.log(`    approvable + market_only:       ${buckets.approvable_market_only}`)
console.log(`    approvable + identity_only:     ${buckets.approvable_identity_only}`)
console.log(`    quarantined (not_eligible):     ${buckets.quarantined_not_eligible}`)
console.log(`    uncertain:                      ${buckets.uncertain}`)
console.log(`    has row but no tcg_card_id:     ${buckets.has_row_no_tcg_card_id}`)
console.log(`    non-approvable with eligibility: ${buckets.non_approvable_eligible}`)
console.log(`    no mapping row at all:          ${noMappingRow}`)
const sum = Object.values(buckets).reduce((a, b) => a + b, 0) + noMappingRow
console.log(`    SUM:                            ${sum}  (must equal 831: ${sum === 831 ? '✓' : '✗'})`)

// 91 vs 71 breakdown
const noTcg = topMappings.filter(m => !m.tcg_card_id)
let withPromoPrefix = 0, withoutPromoPrefix = 0
const PREFIX_RE = /#\s*(SWSH|XY|SM|BW|DP|HGSS|TG|GG)\d/i
for (const m of noTcg) {
  if (PREFIX_RE.test(m.pp_card_name || '')) withPromoPrefix++
  else withoutPromoPrefix++
}
console.log(`\n  "91 vs 71" explained — mappings in top-831 with no tcg_card_id (${noTcg.length} total):`)
console.log(`    with recognised promo prefix (SWSH/XY/SM/BW/DP/HGSS/TG/GG): ${withPromoPrefix}`)
console.log(`    with no recognised prefix (vintage, variant-tag, retail-pack): ${withoutPromoPrefix}`)
console.log(`\n  Recovery-script output had 71 "no_prefix" out of the pre-recovery 147 unmapped.`)
console.log(`  After recovery: 147 − 56 matched = 91 remaining with tcg_card_id=null.`)
console.log(`  Of those 91, 71 still have no recognised prefix (unchanged — the 56 recovered`)
console.log(`  all had prefixes that resolved; the 20 others with prefixes that didn't resolve`)
console.log(`  stay in the 91 "has row, no tcg_card_id" bucket.`)

// ============ ITEM 3 ============
console.log('\n=== ITEM 3: Ingestion cycle check ===\n')

const { data: cursor } = await sb.from('pokemon_tcg_ingestion_cursor').select('*')
console.log('  cursor:', JSON.stringify(cursor?.[0], null, 2))

const { data: runs } = await sb.from('pokemon_tcg_ingestion_runs').select('*').order('started_at', { ascending: false }).limit(5)
console.log(`\n  last 5 runs:`)
for (const r of runs) {
  console.log(`    ${r.started_at.slice(11, 19)} state=${r.state} credits=${r.credits_spent} sets=${r.metadata?.sets_processed_this_run ?? '?'} remaining=${r.metadata?.monthly_remaining ?? '?'} cycle_complete=${r.metadata?.cycle_complete ?? false}`)
}

// Count distinct cycle dates to detect duplicates
const { data: allRuns } = await sb.from('pokemon_tcg_ingestion_runs')
  .select('started_at,state,metadata,credits_spent')
  .eq('provider', 'tcggraph')
  .eq('kind', 'full_catalogue')
  .order('started_at', { ascending: false })
  .limit(50)
const todayStr = new Date().toISOString().slice(0, 10)
const todaysRuns = (allRuns || []).filter(r => r.started_at.startsWith(todayStr))
const todaysCredits = todaysRuns.reduce((a, r) => a + (r.credits_spent || 0), 0)
const todaysSets = todaysRuns.reduce((a, r) => a + (r.metadata?.sets_processed_this_run || 0), 0)
console.log(`\n  Today (${todayStr}):`)
console.log(`    chunk runs: ${todaysRuns.length}`)
console.log(`    sets processed total: ${todaysSets}`)
console.log(`    credits spent total: ${todaysCredits}`)

// ============ ITEM 4 ============
console.log('\n=== ITEM 4: approval dry-run reality check ===\n')

const cohortDetail = await fetchAll('v_pokemon_tcg_identity_safe_cohort', 'mapping_id,risk_class,matcher_eligibility,recommended_eligibility')
const uniqIds = new Set(cohortDetail.map(r => r.mapping_id))
console.log(`  rows: ${cohortDetail.length}`)
console.log(`  unique mapping_ids: ${uniqIds.size}`)
console.log(`  duplicates: ${cohortDetail.length - uniqIds.size}`)

const byRisk = {}
const byMatcher = {}
const byRecommended = {}
for (const c of cohortDetail) {
  byRisk[c.risk_class] = (byRisk[c.risk_class] || 0) + 1
  byMatcher[c.matcher_eligibility] = (byMatcher[c.matcher_eligibility] || 0) + 1
  byRecommended[c.recommended_eligibility] = (byRecommended[c.recommended_eligibility] || 0) + 1
}
console.log('\n  by risk_class:')
for (const [k, v] of Object.entries(byRisk).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(26)} ${v}`)
console.log('\n  by matcher_eligibility:')
for (const [k, v] of Object.entries(byMatcher).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(16)} ${v}`)

// Verify each mapping satisfies approvability
const detailIds = [...uniqIds]
let notApprovable = 0
let notVerifiedConfidence = 0
let alreadyApproved = 0
for (let i = 0; i < detailIds.length; i += 100) {
  const chunk = detailIds.slice(i, i + 100)
  const { data } = await sb.from('pokemon_tcg_mappings').select('id,review_status,confidence').in('id', chunk)
  for (const r of (data || [])) {
    if (!['pending_review', 'unmatched'].includes(r.review_status)) notApprovable++
    if (r.review_status === 'approved') alreadyApproved++
    if (r.confidence !== 'verified') notVerifiedConfidence++
  }
}
console.log(`\n  mappings in cohort with non-approvable status: ${notApprovable}`)
console.log(`  mappings in cohort with confidence != verified: ${notVerifiedConfidence}`)
console.log(`  already approved: ${alreadyApproved}`)

// Verify no quarantined classes leaked in
const quarantinedClasses = ['ambiguous_variant', 'conflicting_identity', 'unverifiable']
const leaked = cohortDetail.filter(r => quarantinedClasses.includes(r.risk_class))
console.log(`  quarantined-class rows in cohort: ${leaked.length} (must be 0)`)
