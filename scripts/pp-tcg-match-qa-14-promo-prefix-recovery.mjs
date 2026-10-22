// PP-TCG-APPROVAL-02 §5 — scoped matcher for the SWSH/XY/SM/TG/GG
// promo-prefix unmapped cards in the high-traffic cohort.
//
// Zero widening of QA criteria. Deterministic match requires:
//   • PP card_number prefix exactly matches TCG set code's number
//     convention (e.g. "SWSH144" → swshp with collector_number="SWSH144")
//   • Normalised card name (strip variant tags) exactly matches
//     TCG card name
//   • PP language == TCG language (both en)
//
// Script runs in --dry-run by default. --apply inserts a new mapping
// row with confidence='verified' + review_status='pending_review' +
// pricing_eligibility='market_only' (safest default — the operator
// can promote to bulk_safe after QA re-run if the card has single
// printing).

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

function normName(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .replace(/\[.*?\]/g, '')         // strip PP [Variant] tags
    .replace(/#\s*\S+\s*/g, '')      // strip "#XX..." tokens anywhere
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

// Map PP card-number prefix → candidate TCG set code
const PREFIX_MAP = {
  SWSH: 'swshp',
  XY: 'xyp',
  SM: 'smp',
  BW: 'bwp',
  HGSS: 'hsp',
  DP: 'dpp',
  // TG, GG have multiple EN sets — handled below with disambiguation
}

const GG_SETS = ['swsh12pt5gg']     // Crown Zenith Galarian Gallery — only EN GG set in catalogue
const TG_SETS = ['swsh9tg', 'swsh10tg', 'swsh11tg', 'swsh12tg']  // all EN Trainer Gallery subsets

async function fetchAll(table, select, filters = (q) => q, orderCol = 'id') {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filters(sb.from(table).select(select).order(orderCol)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

console.log('[1/4] fetching no_mapping high-traffic cards…')
const { data: topMappings } = await sb.from('pokemon_tcg_mappings')
  .select('id,pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,review_status,confidence,commercial_rank')
  .not('commercial_rank', 'is', null)
  .lte('commercial_rank', 831)
  .is('tcg_card_id', null)
  .order('commercial_rank')

console.log(`     ${topMappings.length} top-831 mappings with no tcg_card_id`)

// Extract card number prefix
function parseNumber(name, ppNumber) {
  // Prefer the pp_card_name "#XY74" form, fall back to pp.card_number
  const m = (name || '').match(/#\s*([A-Z]+\d+[A-Za-z]*)/i)
  if (m) return m[1].toUpperCase()
  if (ppNumber && /^[A-Z]+\d+/i.test(ppNumber)) return ppNumber.toUpperCase()
  return null
}

function pickPrefix(numStr) {
  // Longer prefixes first so SWSH matches before SM
  if (!numStr) return null
  if (/^SWSH\d/i.test(numStr)) return 'SWSH'
  if (/^HGSS\d/i.test(numStr)) return 'HGSS'
  if (/^XY\d/i.test(numStr)) return 'XY'
  if (/^SM\d/i.test(numStr)) return 'SM'
  if (/^BW\d/i.test(numStr)) return 'BW'
  if (/^DP\d/i.test(numStr)) return 'DP'
  if (/^TG\d/i.test(numStr)) return 'TG'
  if (/^GG\d/i.test(numStr)) return 'GG'
  return null
}

// Augment with PP cards table for ppNumber
console.log('[2/4] enriching with PP cards.card_number…')
const ppSlugs = topMappings.map(m => m.pp_card_slug)
const ppCards = []
for (let i = 0; i < ppSlugs.length; i += 100) {
  const chunk = ppSlugs.slice(i, i + 100)
  const { data } = await sb.from('cards').select('card_slug,card_name,card_number,language,set_name,image_url')
    .in('card_slug', chunk)
  ppCards.push(...(data || []))
}
const ppBySlug = new Map(ppCards.map(c => [c.card_slug, c]))

console.log('[3/4] matching against TCG promo set catalogues…')

// Pre-fetch all cards from the candidate TCG sets
const candidateSetCodes = [...new Set([...Object.values(PREFIX_MAP), ...GG_SETS, ...TG_SETS])]
const providerCards = []
for (let i = 0; i < candidateSetCodes.length; i += 20) {
  const chunk = candidateSetCodes.slice(i, i + 20)
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,tcg_set_code,tcg_card_name,tcg_collector_number,tcg_language')
    .eq('tcg_language', 'en')
    .in('tcg_set_code', chunk)
  providerCards.push(...(data || []))
}
console.log(`     ${providerCards.length} candidate TCG cards across ${candidateSetCodes.length} sets`)

const bySetCode = new Map()
for (const pc of providerCards) {
  if (!bySetCode.has(pc.tcg_set_code)) bySetCode.set(pc.tcg_set_code, [])
  bySetCode.get(pc.tcg_set_code).push(pc)
}

// Attempt matches
const results = { matched: [], no_promo_set: [], number_not_found: [], ambiguous_tg: [], name_mismatch: [], no_prefix: [] }

for (const m of topMappings) {
  const pp = ppBySlug.get(m.pp_card_slug)
  const ppCardName = m.pp_card_name
  const ppNumber = pp?.card_number
  const num = parseNumber(ppCardName, ppNumber)
  if (!num) { results.no_prefix.push({ ...m }); continue }
  const prefix = pickPrefix(num)
  if (!prefix) { results.no_prefix.push({ ...m, num }); continue }

  let candidates = []
  if (prefix === 'TG') {
    candidates = TG_SETS.flatMap(c => bySetCode.get(c) || []).filter(c => c.tcg_collector_number?.toUpperCase() === num)
    if (candidates.length !== 1) {
      results.ambiguous_tg.push({ ...m, num, found: candidates.length })
      continue
    }
  } else if (prefix === 'GG') {
    candidates = GG_SETS.flatMap(c => bySetCode.get(c) || []).filter(c => c.tcg_collector_number?.toUpperCase() === num)
  } else {
    const setCode = PREFIX_MAP[prefix]
    if (!setCode || !bySetCode.has(setCode)) { results.no_promo_set.push({ ...m, prefix }); continue }
    candidates = bySetCode.get(setCode).filter(c => c.tcg_collector_number?.toUpperCase() === num)
  }

  if (candidates.length === 0) { results.number_not_found.push({ ...m, prefix, num }); continue }

  // Pick candidate whose name matches
  const ppN = normName(ppCardName)
  const hit = candidates.find(c => normName(c.tcg_card_name) === ppN)
  if (!hit) {
    results.name_mismatch.push({
      ...m, prefix, num,
      candidates: candidates.map(c => ({ name: c.tcg_card_name, card_id: c.tcg_card_id, printing: c.tcg_printing_key })),
      pp_normalized: ppN,
    })
    continue
  }
  results.matched.push({
    mapping_id: m.id,
    pp_card_slug: m.pp_card_slug,
    pp_card_name: ppCardName,
    rank: m.commercial_rank,
    tcg_card_id: hit.tcg_card_id,
    tcg_printing_key: hit.tcg_printing_key,
    tcg_set_code: hit.tcg_set_code,
    tcg_name: hit.tcg_card_name,
    num,
    prefix,
  })
}

console.log('\n=== Diagnosis ===')
console.log(`  matched:          ${results.matched.length}`)
console.log(`  number_not_found: ${results.number_not_found.length}  (prefix recognised but no TCG card with that number)`)
console.log(`  ambiguous_tg:     ${results.ambiguous_tg.length}  (TG number appears in multiple trainer gallery sets)`)
console.log(`  name_mismatch:    ${results.name_mismatch.length}  (TCG card with the number exists but name differs)`)
console.log(`  no_promo_set:     ${results.no_promo_set.length}  (TCG set for this prefix not in catalogue)`)
console.log(`  no_prefix:        ${results.no_prefix.length}  (no SWSH/XY/SM/TG/GG/BW/DP/HGSS prefix in PP number)`)

console.log('\n=== Top 15 matched (highest-click first) ===')
for (const r of results.matched.slice(0, 15)) {
  console.log(`  rank=${String(r.rank).padStart(4)}  ${(r.pp_card_name || '').slice(0, 36).padEnd(36)} → ${r.tcg_set_code}#${r.num} card_id=${r.tcg_card_id}`)
}

if (results.name_mismatch.length > 0) {
  console.log('\n=== Name mismatches (operator review) ===')
  for (const r of results.name_mismatch.slice(0, 10)) {
    console.log(`  rank=${String(r.rank).padStart(4)}  pp="${(r.pp_card_name || '').slice(0, 40)}" (norm=${r.pp_normalized})`)
    for (const c of r.candidates.slice(0, 3)) console.log(`                   tcg="${c.name}" card_id=${c.card_id} printing=${c.printing}`)
  }
}

writeFileSync('scripts/_pp-tcg-match-qa/promo-prefix-recovery.json', JSON.stringify(results, null, 2))
console.log('\nreport → scripts/_pp-tcg-match-qa/promo-prefix-recovery.json')

if (!APPLY) {
  console.log('\n[dry-run] no writes. Re-run with --apply to insert the matched mappings.\n')
  process.exit(0)
}

// APPLY: upsert the matched mappings
console.log('\n[apply] upserting matched mappings…')
const BATCH = 100
let applied = 0
for (let i = 0; i < results.matched.length; i += BATCH) {
  const chunk = results.matched.slice(i, i + BATCH)
  const rows = chunk.map(r => ({
    id: r.mapping_id,
    tcg_card_id: r.tcg_card_id,
    tcg_printing_key: r.tcg_printing_key,
    tcg_set_code: r.tcg_set_code,
    tcg_name: r.tcg_name,
    tcg_language: 'en',
    confidence: 'verified',
    match_method: 'promo_prefix_scoped_matcher',
    review_status: 'pending_review',       // not auto-approved; still needs operator sign-off via the identity-approval script
    pricing_eligibility: 'market_only',     // conservative default: no bulk graded until operator confirms
    updated_at: new Date().toISOString(),
  }))
  for (const r of rows) {
    const { error } = await sb.from('pokemon_tcg_mappings').update({
      tcg_card_id: r.tcg_card_id,
      tcg_printing_key: r.tcg_printing_key,
      tcg_set_code: r.tcg_set_code,
      tcg_name: r.tcg_name,
      tcg_language: r.tcg_language,
      confidence: r.confidence,
      match_method: r.match_method,
      review_status: r.review_status,
      pricing_eligibility: r.pricing_eligibility,
      updated_at: r.updated_at,
    }).eq('id', r.id)
    if (error) throw new Error(`update ${r.id}: ${error.message}`)
  }
  applied += chunk.length
  if (i % 500 === 0) console.log(`     applied ${applied}…`)
}
console.log(`     applied ${applied} matched mappings`)
console.log('\n[done] matched mappings updated. Re-run QA script to update pokemon_tcg_mapping_qa rows for these cards.')
