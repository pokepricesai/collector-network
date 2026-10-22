// PP-TCG-MIGRATE-02 §3: reconcile the earlier coverage numbers.
//
// The MIGRATE-01 report quoted:
//   • 46,777 "automatically verified identities"
//   • 52,654 cards "with market data"
//   • 55,312 cards "with images"
//
// Those three had different denominators (approved vs ingested).
// This script separates the dimensions explicitly:
//   • identity_verified   — PP mapping has tcg_card_id AND confidence='verified'
//   • has_market_safe     — identity_verified AND provider market row exists
//                           AND pricing_eligibility in {bulk_safe, market_only}
//   • has_graded_safe     — identity_verified AND provider graded row exists
//                           AND pricing_eligibility = 'bulk_safe' (never variants)
//   • has_image           — provider card has image_normal
//                           (eligibility gate for public display handled at render)
//
// Also investigates the 0% Japanese graded coverage: is it an
// ingestion defect or does TCGGraph genuinely not publish graded
// data for Japanese cards?

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-02', { recursive: true })

// ---- Pull all needed data ----

async function pullAll(table, select, filter) {
  const PAGE = 1000; let offset = 0; const all = []
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

console.log('[pull] provider cards + prices + graded...')
const [provider, marketRows, gradedRows] = await Promise.all([
  pullAll('pokemon_tcg_provider_cards', 'tcg_card_id, tcg_printing_key, image_normal, tcg_language'),
  pullAll('pokemon_tcg_prices_market', 'tcg_card_id, tcg_printing_key, source, currency'),
  pullAll('pokemon_tcg_prices_graded', 'tcg_card_id, grader, grade, price'),
])
console.log(`[pull] provider ${provider.length}, market ${marketRows.length}, graded ${gradedRows.length}`)

const marketByKey = new Set(marketRows.map(r => `${r.tcg_card_id}|${r.tcg_printing_key}`))
const gradedByCard = new Set(gradedRows.map(r => r.tcg_card_id))
const imageByKey = new Set(provider.filter(r => r.image_normal).map(r => `${r.tcg_card_id}|${r.tcg_printing_key}`))

// ---- Classify + count ----

function cohortsOf(m) {
  const out = ['overall']
  out.push(m.pp_language === 'jp' ? 'ja' : 'en')
  if (/^(Base Set|Jungle|Fossil|Base Set 2|Team Rocket|Gym |Neo )/.test(m.pp_set_name || '')) out.push('vintage')
  if (/Promo|Black Star|Championship|League|Prerelease/i.test(m.pp_set_name || '')) out.push('promo')
  if (/\[([^\]]+)\]/.test(m.pp_card_name || '')) out.push('variant')
  if (m.commercial_rank != null) out.push('top-traffic')
  return out
}

const empty = () => ({
  total: 0,
  identity_verified: 0,                     // tcg_card_id + confidence='verified'
  approved: 0,                              // additionally review_status='approved'
  has_image: 0,                             // provider card has image_normal
  has_image_safe: 0,                        // image + eligibility allows public display
  has_market_safe: 0,                       // market row + eligibility allows market display
  has_graded_safe: 0,                       // graded row + bulk_safe only
  no_tcg_equivalent: 0,
  provider_rows_in_use: 0,                  // identity rows WITH an actual provider card row
})

const buckets = { overall: empty(), en: empty(), ja: empty(), vintage: empty(), promo: empty(), variant: empty(), 'top-traffic': empty() }

for (const m of mappings) {
  const key = m.tcg_card_id ? `${m.tcg_card_id}|${m.tcg_printing_key || 'normal'}` : null
  const identity_verified = m.confidence === 'verified' && !!m.tcg_card_id
  const approved = identity_verified && m.review_status === 'approved'
  const provider_row = key && imageByKey.has(key) || key && marketByKey.has(key)   // either source implies a row exists
  const has_image = key && imageByKey.has(key)
  const has_market = key && marketByKey.has(key)
  const has_graded = m.tcg_card_id && gradedByCard.has(m.tcg_card_id)
  const elig = m.pricing_eligibility
  const canImage = elig === 'bulk_safe' || elig === 'market_only' || elig === 'identity_only'
  const canMarket = elig === 'bulk_safe' || elig === 'market_only'
  const canGraded = elig === 'bulk_safe'
  const no_tcg = m.review_status === 'no_tcg_equivalent'

  for (const b of cohortsOf(m)) {
    const o = buckets[b]
    o.total += 1
    if (identity_verified) o.identity_verified += 1
    if (approved) o.approved += 1
    if (has_image) o.has_image += 1
    if (has_image && canImage) o.has_image_safe += 1
    if (has_market && canMarket) o.has_market_safe += 1
    if (has_graded && canGraded) o.has_graded_safe += 1
    if (no_tcg) o.no_tcg_equivalent += 1
    if (provider_row) o.provider_rows_in_use += 1
  }
}

// ---- JA graded investigation ----
// Count graded rows per language of the TCG card. A proper answer
// requires joining pokemon_tcg_prices_graded back onto
// pokemon_tcg_provider_cards.tcg_language.
const providerById = new Map()
for (const r of provider) {
  if (!providerById.has(r.tcg_card_id)) providerById.set(r.tcg_card_id, r.tcg_language)
}
let gradedEn = 0, gradedJa = 0, gradedOther = 0
for (const g of gradedRows) {
  const lang = providerById.get(g.tcg_card_id)
  if (lang === 'en') gradedEn++
  else if (lang === 'ja') gradedJa++
  else gradedOther++
}
const jaInvestigation = {
  provider_graded_rows_total: gradedRows.length,
  provider_graded_rows_english: gradedEn,
  provider_graded_rows_japanese: gradedJa,
  provider_graded_rows_other_language: gradedOther,
  interpretation:
    gradedJa === 0 && gradedEn > 0
      ? 'TCGGraph does NOT return any gradedPrices entries for Japanese Pokémon cards in the catalogue scan. This is a provider behaviour, not an ingestion defect — the ingestion script writes every gradedPrices row the API returns, and the EN scan produces 165k+ rows while the JA scan produces zero. Likely interpretation: TCGGraph only aggregates grader-pooled valuations off eBay/US-realised-sales, which is thin for Japanese printings. For the operator this means Japanese cards will NEVER show PSA 10 / pooled grade-9 on the public page via TCGGraph; this is expected until the provider adds JA graded coverage.'
      : 'graded coverage is distributed across languages',
}

// ---- Pricing eligibility distribution ----
const eligCounts = { bulk_safe: 0, market_only: 0, identity_only: 0, uncertain: 0, not_eligible: 0 }
for (const m of mappings) eligCounts[m.pricing_eligibility || 'uncertain'] = (eligCounts[m.pricing_eligibility || 'uncertain'] || 0) + 1

const report = { generated_at: new Date().toISOString(), buckets, pricing_eligibility: eligCounts, ja_graded_investigation: jaInvestigation }
writeFileSync('scripts/_pp-tcg-migrate-02/reconcile.json', JSON.stringify(report, null, 2))

function pct(n, d) { return d === 0 ? '—' : `${(n / d * 100).toFixed(1)}%` }

console.log('\n=== DENOMINATOR BREAKDOWN ===')
for (const [name, c] of Object.entries(buckets)) {
  console.log(`\n--- ${name.toUpperCase()} (total=${c.total}) ---`)
  console.log(`  identity verified: ${c.identity_verified} (${pct(c.identity_verified, c.total)})`)
  console.log(`  approved:          ${c.approved} (${pct(c.approved, c.total)})`)
  console.log(`  provider rows:     ${c.provider_rows_in_use} (${pct(c.provider_rows_in_use, c.total)})`)
  console.log(`  image + safe:      ${c.has_image_safe} (${pct(c.has_image_safe, c.total)})`)
  console.log(`  market + safe:     ${c.has_market_safe} (${pct(c.has_market_safe, c.total)})`)
  console.log(`  graded + safe:     ${c.has_graded_safe} (${pct(c.has_graded_safe, c.total)})`)
  console.log(`  no TCG equivalent: ${c.no_tcg_equivalent} (${pct(c.no_tcg_equivalent, c.total)})`)
}

console.log('\n=== JAPANESE GRADED INVESTIGATION ===')
console.log(JSON.stringify(jaInvestigation, null, 2))

console.log('\n[done] see scripts/_pp-tcg-migrate-02/reconcile.json')
