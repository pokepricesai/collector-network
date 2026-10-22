// PP-TCG-QA-FINAL §1 — recompute pokemon_tcg_mapping_qa.recommended_pricing_eligibility
// with the corrected policy:
//
//   catalogue_corroborated → recommended = prior (no change)
//   internally_consistent  → recommended = prior
//   pricing_restriction    → multi-printing bulk_safe → market_only; no-market → identity_only
//   ambiguous_variant      → quarantine → not_eligible (never identity_only — identity unverified)
//   conflicting_identity   → quarantine → not_eligible (identity conflict)
//   unverifiable           → quarantine → not_eligible (no match found)
//
// Previously the recommender upgraded `not_eligible → identity_only` for unverifiable rows
// and recommended `identity_only` for ambiguous_variant / bulk_safe. Both wrong because
// identity_only exposes the TCG image, which requires a validated identity + a validated
// printing image. Unverifiable, ambiguous and conflicting records don't have that.
//
// Zero TCGGraph credits spent. Supabase writes only to pokemon_tcg_mapping_qa.
//
// Output: scripts/_pp-tcg-match-qa/recompute.json

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

console.log('[1/3] pulling QA rows…')
const qa = await fetchAll(
  'pokemon_tcg_mapping_qa',
  'mapping_id,risk_class,prior_pricing_eligibility,recommended_pricing_eligibility,single_printing,market_price_available,sibling_printings',
)
console.log(`     ${qa.length} QA rows`)

console.log('[2/3] computing corrected recommendations…')

function newRec(r) {
  const prior = r.prior_pricing_eligibility
  switch (r.risk_class) {
    case 'catalogue_corroborated':
    case 'internally_consistent':
      return prior
    case 'pricing_restriction': {
      // Identity is OK. Only pricing eligibility needs tightening.
      // Never upgrade from a quarantine state — if the matcher said uncertain,
      // leave uncertain (operator must triage, not auto-grant imagery).
      if (prior === 'uncertain' || prior === 'not_eligible') return prior
      if (prior === 'bulk_safe' && !r.single_printing) return 'market_only'
      if (!r.market_price_available) return 'identity_only'
      return prior
    }
    case 'ambiguous_variant':
    case 'conflicting_identity':
    case 'unverifiable':
      // Hard quarantine — identity not reliably verified, do NOT upgrade images or prices
      return 'not_eligible'
    default:
      return prior
  }
}

const changes = []
let unchanged = 0
let delta = { restrictive: 0, upgrade: 0, same: 0 }
const ELIG_RANK = { not_eligible: 4, identity_only: 3, market_only: 2, bulk_safe: 1, uncertain: 0 }

for (const r of qa) {
  const next = newRec(r)
  if (next === r.recommended_pricing_eligibility) {
    unchanged++
    continue
  }
  const prevRank = ELIG_RANK[r.recommended_pricing_eligibility] ?? 0
  const nextRank = ELIG_RANK[next] ?? 0
  if (nextRank > prevRank) delta.restrictive++
  else if (nextRank < prevRank) delta.upgrade++
  else delta.same++
  changes.push({ mapping_id: r.mapping_id, old: r.recommended_pricing_eligibility, new: next, risk_class: r.risk_class, prior: r.prior_pricing_eligibility })
}

console.log(`     changes: ${changes.length}  (unchanged: ${unchanged})`)
console.log(`       more restrictive: ${delta.restrictive}`)
console.log(`       less restrictive: ${delta.upgrade}`)
console.log(`       same rank:        ${delta.same}`)

// Distribution of changes by (old → new)
const bucket = {}
for (const c of changes) {
  const k = `${c.old ?? 'null'} → ${c.new ?? 'null'} (risk=${c.risk_class})`
  bucket[k] = (bucket[k] || 0) + 1
}
console.log('\n  By direction:')
for (const [k, v] of Object.entries(bucket).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(70)} ${v}`)

console.log('\n[3/3] writing recommended_pricing_eligibility updates…')
let written = 0
const BATCH = 25

async function updateOne(mappingId, next, retries = 3) {
  for (let a = 0; a < retries; a++) {
    try {
      const { error } = await sb.from('pokemon_tcg_mapping_qa')
        .update({ recommended_pricing_eligibility: next })
        .eq('mapping_id', mappingId)
      if (!error) return
      if (a === retries - 1) throw new Error(error.message)
    } catch (e) {
      if (a === retries - 1) throw e
      await new Promise(res => setTimeout(res, 800 * (a + 1)))
    }
  }
}

for (let i = 0; i < changes.length; i += BATCH) {
  const chunk = changes.slice(i, i + BATCH)
  await Promise.all(chunk.map(c => updateOne(c.mapping_id, c.new)))
  written += chunk.length
  if (i % 1000 === 0) console.log(`     wrote ${written} / ${changes.length}…`)
}
console.log(`     wrote ${written} updates`)

writeFileSync('scripts/_pp-tcg-match-qa/recompute.json', JSON.stringify({
  total_qa_rows: qa.length,
  changes: changes.length,
  unchanged,
  delta,
  bucket,
}, null, 2))

console.log('\n[done]')
