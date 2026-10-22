// PP-TCG-MIGRATE-01: coverage report by cohort.
//
// Measures separately for each cohort (EN, JA, vintage, modern,
// promo, variants, top-traffic):
//   • identity-match count (mapping has tcg_card_id + verified)
//   • has market price count (bulk_safe or market_only + ingested provider row)
//   • has graded price count (bulk_safe + ingested graded row)
//   • has image count (ingested image_normal URL)
//   • no provider equivalent count (no_tcg_equivalent OR unmatched)
//
// No API calls. Pure Supabase reads.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-01', { recursive: true })

// Pull all mappings (full-fat; we need in-memory cohorting)
async function pullAll(table, select, filter) {
  const PAGE = 1000
  let offset = 0
  const all = []
  while (true) {
    let q = sb.from(table).select(select).order('id').range(offset, offset + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

console.log('[pull] mappings...')
const mappings = await pullAll('pokemon_tcg_mappings',
  'pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, confidence, review_status, pricing_eligibility, commercial_rank',
  q => q.eq('provider', 'tcggraph'))
console.log(`[pull] ${mappings.length} mappings`)

console.log('[pull] provider cards (image presence)...')
const provider = await pullAll('pokemon_tcg_provider_cards', 'tcg_card_id, tcg_printing_key, image_normal')
const providerByKey = new Set(provider.map(r => `${r.tcg_card_id}|${r.tcg_printing_key}`))
const providerWithImage = new Set(provider.filter(r => r.image_normal).map(r => `${r.tcg_card_id}|${r.tcg_printing_key}`))
console.log(`[pull] ${provider.length} provider cards; ${providerWithImage.size} with image`)

console.log('[pull] market price keys...')
const market = await pullAll('pokemon_tcg_prices_market', 'tcg_card_id, tcg_printing_key')
const marketSet = new Set(market.map(r => `${r.tcg_card_id}|${r.tcg_printing_key}`))
console.log(`[pull] ${market.length} market rows, ${marketSet.size} unique (card×printing)`)

console.log('[pull] graded price keys...')
const graded = await pullAll('pokemon_tcg_prices_graded', 'tcg_card_id')
const gradedSet = new Set(graded.map(r => r.tcg_card_id))
console.log(`[pull] ${graded.length} graded rows, ${gradedSet.size} unique card_ids`)

function cohortOf(m) {
  const buckets = []
  if (m.pp_language === 'jp') buckets.push('ja')
  else buckets.push('en')
  if (/^(Base Set|Jungle|Fossil|Base Set 2|Team Rocket|Gym |Neo )/.test(m.pp_set_name || '')) buckets.push('vintage')
  else if (/^(Scarlet|Paradox|Twilight|Perfect Order|SV|Shrouded|Prismatic|Journey Together|Destined Rivals|Megalodon|Mega Evolution|Phantasmal Flames)/i.test(m.pp_set_name || '')) buckets.push('modern')
  if (/Promo|Black Star|Championship|McDonald|League|Prerelease/i.test(m.pp_set_name || '')) buckets.push('promo')
  if (/\[([^\]]+)\]/.test(m.pp_card_name || '')) buckets.push('variant')
  if (m.commercial_rank != null) buckets.push('top-traffic')
  return buckets
}

const empty = () => ({
  total: 0,
  identity_verified: 0,
  has_market: 0,
  has_graded: 0,
  has_image: 0,
  no_equivalent: 0,
  pricing: { bulk_safe: 0, market_only: 0, identity_only: 0, uncertain: 0, not_eligible: 0 },
})
const cohorts = { en: empty(), ja: empty(), vintage: empty(), modern: empty(), promo: empty(), variant: empty(), 'top-traffic': empty() }
const overall = empty()

for (const m of mappings) {
  const key = m.tcg_card_id ? `${m.tcg_card_id}|${m.tcg_printing_key || 'normal'}` : null
  const identity_verified = m.confidence === 'verified' && !!m.tcg_card_id
  const has_market = key && marketSet.has(key)
  const has_graded = m.tcg_card_id && gradedSet.has(m.tcg_card_id) && m.pricing_eligibility === 'bulk_safe'
  const has_image = key && providerWithImage.has(key)
  const no_equivalent = m.review_status === 'no_tcg_equivalent'

  const bump = (c) => {
    c.total += 1
    if (identity_verified) c.identity_verified += 1
    if (has_market) c.has_market += 1
    if (has_graded) c.has_graded += 1
    if (has_image) c.has_image += 1
    if (no_equivalent) c.no_equivalent += 1
    c.pricing[m.pricing_eligibility || 'uncertain'] += 1
  }
  bump(overall)
  for (const bucket of cohortOf(m)) bump(cohorts[bucket])
}

const report = { overall, cohorts }
writeFileSync('scripts/_pp-tcg-migrate-01/coverage.json', JSON.stringify(report, null, 2))

function pct(n, d) { return d === 0 ? '—' : `${(n / d * 100).toFixed(1)}%` }

console.log('\n=== OVERALL ===')
console.log(`total: ${overall.total}`)
console.log(`identity verified: ${overall.identity_verified} (${pct(overall.identity_verified, overall.total)})`)
console.log(`has market price:  ${overall.has_market} (${pct(overall.has_market, overall.total)})`)
console.log(`has graded price:  ${overall.has_graded} (${pct(overall.has_graded, overall.total)})`)
console.log(`has image:         ${overall.has_image} (${pct(overall.has_image, overall.total)})`)
console.log(`no TCG equivalent: ${overall.no_equivalent} (${pct(overall.no_equivalent, overall.total)})`)
console.log(`pricing_eligibility:`, overall.pricing)

for (const [name, c] of Object.entries(cohorts)) {
  console.log(`\n--- ${name.toUpperCase()} (${c.total}) ---`)
  console.log(`  identity: ${c.identity_verified} (${pct(c.identity_verified, c.total)})`)
  console.log(`  market:   ${c.has_market} (${pct(c.has_market, c.total)})`)
  console.log(`  graded:   ${c.has_graded} (${pct(c.has_graded, c.total)})`)
  console.log(`  image:    ${c.has_image} (${pct(c.has_image, c.total)})`)
  console.log(`  no-eq:    ${c.no_equivalent} (${pct(c.no_equivalent, c.total)})`)
}

console.log('\n[done] see scripts/_pp-tcg-migrate-01/coverage.json')
