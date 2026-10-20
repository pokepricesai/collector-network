// Scoped re-QA for the mappings touched by pp-tcg-match-final-01-variant-recovery.mjs.
// Mirrors the classification logic from pp-tcg-match-qa-02-run.mjs but only writes
// pokemon_tcg_mapping_qa rows for the specific mapping_ids in the latest run.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

const plan = JSON.parse(readFileSync('scripts/_pp-tcg-match-final/variant-recovery.json', 'utf-8'))
const recoveredIds = plan.recovered.map(r => r.mapping_id)
console.log('scoped re-QA on', recoveredIds.length, 'mapping_ids')

// ---- Normalisation (consistent with migrate-01 QA writer) ----
function normName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/\[.*?\]/g, '').replace(/#\s*\S+\s*/g, '').replace(/[^a-z0-9]+/g, '').trim()
}
function normNumber(s) {
  if (!s) return ''
  return String(s).toUpperCase().replace(/^0+/, '').replace(/\//g, '').trim()
}
function extractPpNumber(name) {
  if (!name) return ''
  const m = name.match(/#\s*([A-Z0-9]+[A-Za-z]*)/i)
  return m ? m[1] : ''
}
function normSetName(s) { return s ? String(s).toLowerCase().replace(/[^a-z0-9]+/g, '') : '' }
function normLang(s) { const v = (s || '').toLowerCase().trim(); if (v === 'jp' || v === 'ja' || v === 'japanese') return 'ja'; if (v === 'en' || v === 'english') return 'en'; return v }

const VARIANT_PRINTING_KEYS = new Set(['pokemon-center','prize-pack','sparkle','staff','stamped','jumbo','glossy','cosmos-holo','reverse-holo','first-edition','1st-edition','1st-edition-foil','shadowless','crystal','promo','tcg-online','parallel'])

// Pull mappings
const maps = []
for (let i = 0; i < recoveredIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_mappings').select('id,pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,tcg_printing_key,tcg_set_code,tcg_language,tcg_name,confidence,pricing_eligibility,review_status').in('id', recoveredIds.slice(i, i + 100))
  maps.push(...(data || []))
}
console.log('mappings fetched:', maps.length)

// Pull provider_cards + market + graded for these card_ids (filtered active)
const cardIds = [...new Set(maps.map(m => m.tcg_card_id).filter(Boolean))]
const providerByKey = new Map()
const printingsByCard = new Map()
const cardMetaById = new Map()
for (let i = 0; i < cardIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,tcg_set_code,tcg_set_name,tcg_language,tcg_card_name,tcg_collector_number,image_normal,raw_payload,provider_status')
    .in('tcg_card_id', cardIds.slice(i, i + 100))
    .eq('provider_status', 'active')
  for (const pc of (data || [])) {
    providerByKey.set(`${pc.tcg_card_id}|${pc.tcg_printing_key}`, pc)
    if (!printingsByCard.has(pc.tcg_card_id)) printingsByCard.set(pc.tcg_card_id, [])
    printingsByCard.get(pc.tcg_card_id).push(pc.tcg_printing_key)
    if (!cardMetaById.has(pc.tcg_card_id)) cardMetaById.set(pc.tcg_card_id, pc)
  }
}
const marketKeys = new Set()
for (let i = 0; i < cardIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_prices_market').select('tcg_card_id,tcg_printing_key').in('tcg_card_id', cardIds.slice(i, i + 100))
  for (const r of (data || [])) marketKeys.add(`${r.tcg_card_id}|${r.tcg_printing_key}`)
}

// bySlug detection for ambiguous_variant
const bySlug = new Map()
for (let i = 0; i < cardIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_mappings').select('id,tcg_card_id,tcg_printing_key').in('tcg_card_id', cardIds.slice(i, i + 100))
  for (const m of (data || [])) {
    if (!m.tcg_card_id) continue
    if (!bySlug.has(m.tcg_card_id)) bySlug.set(m.tcg_card_id, [])
    bySlug.get(m.tcg_card_id).push(m)
  }
}

const qaRows = []
const classCounts = {}
for (const m of maps) {
  const warnings = []
  const evidence = {}
  const pc = providerByKey.get(`${m.tcg_card_id}|${m.tcg_printing_key}`)
  const anyPc = cardMetaById.get(m.tcg_card_id)
  const siblings = printingsByCard.get(m.tcg_card_id) || []
  const singlePrinting = siblings.length === 1

  const ppName = normName(m.pp_card_name)
  const tcgName = normName(pc?.tcg_card_name ?? anyPc?.tcg_card_name)
  const nameExactMatch = Boolean(ppName && tcgName && ppName === tcgName)
  const ppNumber = normNumber(extractPpNumber(m.pp_card_name))
  const tcgNumber = normNumber(pc?.tcg_collector_number ?? anyPc?.tcg_collector_number)
  const numberExactMatch = Boolean(ppNumber && tcgNumber && ppNumber === tcgNumber)
  const ppSet = normSetName(m.pp_set_name)
  const tcgSet = normSetName(pc?.tcg_set_name ?? anyPc?.tcg_set_name)
  const setMatch = Boolean(ppSet && tcgSet && (ppSet === tcgSet || ppSet.includes(tcgSet) || tcgSet.includes(ppSet)))
  const ppLang = normLang(m.pp_language)
  const tcgLang = normLang(pc?.tcg_language ?? m.tcg_language ?? anyPc?.tcg_language)
  const languageMatch = Boolean(ppLang && tcgLang && ppLang === tcgLang)
  const imageAvailable = Boolean(pc?.image_normal || anyPc?.image_normal)
  const marketPriceAvailable = marketKeys.has(`${m.tcg_card_id}|${m.tcg_printing_key}`)
  const ext = pc?.raw_payload?.external_ids || null
  const hasTcgplayerRef = Boolean(ext?.tcgplayerId || ext?.tcgplayer_id)
  const hasCardmarketRef = Boolean(ext?.cardmarketId || ext?.cardmarket_id)

  evidence.pp = { name: m.pp_card_name, set: m.pp_set_name, language: m.pp_language, extracted_number: ppNumber }
  evidence.tcg = { name: pc?.tcg_card_name ?? anyPc?.tcg_card_name, set: pc?.tcg_set_name ?? anyPc?.tcg_set_name, language: tcgLang, collector_number: tcgNumber, printing_key: m.tcg_printing_key, card_id: m.tcg_card_id }
  evidence.external_ids = ext
  evidence.sibling_printings = siblings

  let risk = null
  const others = (bySlug.get(m.tcg_card_id) || []).filter(x => x.id !== m.id)
  if (others.some(x => x.tcg_printing_key === m.tcg_printing_key)) {
    risk = 'ambiguous_variant'
    warnings.push(`shared target with ${others.length} other PP mapping(s)`)
  }
  if (!risk) {
    const identityClean = nameExactMatch && numberExactMatch && setMatch && languageMatch
    const gradedSafe = singlePrinting || m.pricing_eligibility !== 'bulk_safe'
    if (identityClean && imageAvailable && marketPriceAvailable && gradedSafe && (hasTcgplayerRef || hasCardmarketRef)) risk = 'catalogue_corroborated'
    else if (identityClean && imageAvailable) risk = marketPriceAvailable ? 'internally_consistent' : 'pricing_restriction'
    else risk = 'unverifiable'
  }

  let rec = m.pricing_eligibility
  if (risk === 'pricing_restriction') {
    if (m.pricing_eligibility === 'uncertain' || m.pricing_eligibility === 'not_eligible') rec = m.pricing_eligibility
    else if (m.pricing_eligibility === 'bulk_safe' && !singlePrinting) rec = 'market_only'
    else if (!marketPriceAvailable) rec = 'identity_only'
  } else if (risk === 'ambiguous_variant' || risk === 'conflicting_identity' || risk === 'unverifiable') {
    rec = 'not_eligible'
  }

  classCounts[risk] = (classCounts[risk] || 0) + 1
  qaRows.push({
    mapping_id: m.id,
    pp_card_slug: m.pp_card_slug,
    tcg_card_id: m.tcg_card_id,
    tcg_printing_key: m.tcg_printing_key,
    risk_class: risk,
    prior_pricing_eligibility: m.pricing_eligibility,
    recommended_pricing_eligibility: rec,
    has_tcgplayer_ref: hasTcgplayerRef,
    has_cardmarket_ref: hasCardmarketRef,
    name_exact_match: nameExactMatch,
    number_exact_match: numberExactMatch,
    set_match: setMatch,
    language_match: languageMatch,
    image_available: imageAvailable,
    market_price_available: marketPriceAvailable,
    single_printing: singlePrinting,
    sibling_printings: siblings,
    evidence,
    warnings,
  })
}

// Upsert
for (let i = 0; i < qaRows.length; i += 50) {
  const { error } = await sb.from('pokemon_tcg_mapping_qa').upsert(qaRows.slice(i, i + 50), { onConflict: 'mapping_id' })
  if (error) throw new Error(`qa upsert: ${error.message}`)
}

console.log('\nnew risk_class distribution for the 674 recovered:')
for (const [k, v] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) console.log('  ' + k.padEnd(26) + ' ' + v)
