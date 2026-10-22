// PP-TCG-MATCH-02: analyze the current uncertain / identity_only
// cohorts and the promo landscape, so the enhanced matcher knows
// what buckets of cards are rescuable without manual review.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-02', { recursive: true })

const en = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-en.json', 'utf-8'))
const ja = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-ja.json', 'utf-8'))
const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))
const tcgRows = [...en.rows, ...ja.rows]
console.log(`[inputs] TCGGraph: ${tcgRows.length} cards, ${sets.length} sets`)

function normName(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() }
function normNum(s) { const str=String(s??'').trim(); return /^0+\d+$/.test(str) ? str.replace(/^0+/,'') : str.toLowerCase() }

// Index for uniqueness checks
const nameNumLang = new Map()
for (const c of tcgRows) {
  const k = `${normName(c.name)}|${normNum(c.collectorNumber)}|${c.language}`
  if (!nameNumLang.has(k)) nameNumLang.set(k, [])
  nameNumLang.get(k).push(c)
}
console.log(`[inputs] indexed name+num+lang buckets: ${nameNumLang.size}`)

// Pull mappings grouped by eligibility
async function pullBucket(elig) {
  const PAGE = 1000
  let offset = 0
  const all = []
  while (true) {
    const { data, error } = await sb.from('pokemon_tcg_mappings')
      .select('id, pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_language, tcg_name, confidence, review_status, pricing_eligibility, commercial_rank')
      .eq('provider', 'tcggraph')
      .eq('pricing_eligibility', elig)
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return all
}

const uncertain = await pullBucket('uncertain')
const identityOnly = await pullBucket('identity_only')
console.log(`[pull] uncertain=${uncertain.length}, identity_only=${identityOnly.length}`)

// --- 1. Of uncertain cards, how many have a UNIQUE name+number+language match in TCG? ---
let uncertainUniqueGlobal = 0
let uncertainMultiGlobal = 0
let uncertainNoGlobal = 0
const uncertainPromoSamples = []

function extractVariantTag(s) { const m=(s||'').match(/\[([^\]]+)\]/); return m?m[1].trim():null }
function cleanName(s) {
  if (!s) return ''
  return s.replace(/\s*#\s*[A-Za-z0-9\-\/]+\s*$/i, '')
          .replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}

for (const m of uncertain) {
  const name = normName(cleanName(m.pp_card_name))
  const num = normNum(m.pp_card_number || (m.pp_card_name||'').match(/#\s*([A-Za-z0-9\-\/]+)\s*$/)?.[1])
  const tcgLang = m.pp_language === 'jp' ? 'ja' : 'en'
  const k = `${name}|${num}|${tcgLang}`
  const hits = nameNumLang.get(k) || []
  if (hits.length === 1) uncertainUniqueGlobal++
  else if (hits.length > 1) uncertainMultiGlobal++
  else uncertainNoGlobal++
}
console.log(`\n[uncertain] has global-unique TCG name+num+lang match: ${uncertainUniqueGlobal}`)
console.log(`[uncertain] multiple candidates:                        ${uncertainMultiGlobal}`)
console.log(`[uncertain] no candidate:                                ${uncertainNoGlobal}`)

// --- 2. PP promo-set distribution + TCG promo-set distribution ---
const ppPromoSets = {}
for (const r of [...uncertain, ...identityOnly]) {
  if (!r.pp_set_name) continue
  const isPromo = /Promo|Black Star|Championship|McDonald|Topps|Burger King|League|Prerelease/i.test(r.pp_set_name)
  if (isPromo) ppPromoSets[r.pp_set_name] = (ppPromoSets[r.pp_set_name] || 0) + 1
}
console.log('\n[promo] PP promo set names (in uncertain + identity_only, top 20):')
for (const [k, v] of Object.entries(ppPromoSets).sort((a,b)=>b[1]-a[1]).slice(0,20)) {
  console.log(`  ${k.padEnd(42)} ${v}`)
}

// TCG promo set codes
const tcgPromoSets = sets.filter(s => /Promo|Black Star|Championship|League|Prerelease/i.test(s.name || ''))
console.log(`\n[promo] TCG promo-ish set codes: ${tcgPromoSets.length}`)
for (const s of tcgPromoSets.slice(0, 20)) {
  console.log(`  ${s.code.padEnd(14)} ${s.name} (${s.language}) release=${s.releasedAt} cards=${s.cards}`)
}

// --- 3. For identity_only promos: what was the matcher's chosen target? ---
let promoIdentityOnlyPromoted = 0
let promoIdentityOnlyKept = 0
for (const r of identityOnly) {
  const isPromo = /Promo|Black Star|Championship/i.test(r.pp_set_name || '')
  if (!isPromo) continue
  // If matched TCG is already in a promo set code (xyp, smp, svp etc.), it's probably correct — just needs lifting
  const tcgSetIsPromoSpecific = tcgPromoSets.some(s => r.tcg_card_id?.startsWith(`pkm_${s.code}_`))
  if (tcgSetIsPromoSpecific) promoIdentityOnlyPromoted++
  else promoIdentityOnlyKept++
}
console.log(`\n[promo] identity_only promos: ${promoIdentityOnlyPromoted + promoIdentityOnlyKept}`)
console.log(`[promo]   already in a TCG promo set:  ${promoIdentityOnlyPromoted}`)
console.log(`[promo]   mapped to non-promo TCG set: ${promoIdentityOnlyKept}`)

// --- 4. Collector-number pattern patterns in uncertain promos ---
const collectorPatterns = {}
for (const r of uncertain) {
  const isPromo = /Promo|Black Star|Championship/i.test(r.pp_set_name || '')
  if (!isPromo) continue
  const num = r.pp_card_name?.match(/#\s*([A-Za-z0-9\-\/]+)\s*$/)?.[1]
  if (!num) continue
  const prefix = num.match(/^[A-Za-z]+/)?.[0]
  if (prefix) collectorPatterns[prefix] = (collectorPatterns[prefix] || 0) + 1
}
console.log('\n[promo] uncertain promo collector-number alpha prefixes:')
for (const [k, v] of Object.entries(collectorPatterns).sort((a,b)=>b[1]-a[1]).slice(0,20)) {
  console.log(`  ${k.padEnd(10)} ${v}`)
}

// --- 5. Save for the matcher upgrade ---
const summary = {
  totals: {
    uncertain: uncertain.length,
    identity_only: identityOnly.length,
  },
  uncertain_global_unique_identity: uncertainUniqueGlobal,
  uncertain_multi: uncertainMultiGlobal,
  uncertain_no_candidate: uncertainNoGlobal,
  pp_promo_sets_distribution: ppPromoSets,
  tcg_promo_sets: tcgPromoSets.map(s => ({ code: s.code, name: s.name, language: s.language, releasedAt: s.releasedAt, cards: s.cards })),
  identity_only_promo_already_in_tcg_promo_set: promoIdentityOnlyPromoted,
  identity_only_promo_mapped_elsewhere: promoIdentityOnlyKept,
  uncertain_promo_collector_prefixes: collectorPatterns,
}
writeFileSync('scripts/_pp-tcg-match-02/analyze.json', JSON.stringify(summary, null, 2))
console.log('\n[done] see scripts/_pp-tcg-match-02/analyze.json')
