// PP-TCG-MATCH §1+§2: full-cohort automated QA.
//
// Audits every pokemon_tcg_mappings row (not just bulk_safe) and
// writes a pokemon_tcg_mapping_qa row per mapping with:
//   - 6-class risk assignment
//   - 7 deterministic check results
//   - detailed evidence JSON
//   - warning strings for operator review
//
// Zero TCGGraph credits spent. Supabase reads only.
//
// Independent corroboration via external marketplace IDs stored in
// pokemon_tcg_provider_cards.raw_payload.external_ids:
//   - tcgplayerId     → TCGplayer catalogue cross-reference
//   - cardmarketId    → Cardmarket catalogue cross-reference
// Presence of either = this specific printing is listable at a
// major third-party marketplace (independent evidence of its
// physical existence beyond TCGGraph's own catalogue).

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

// -------- Normalisation helpers --------

function normalizeName(s) {
  if (!s) return ''
  return String(s)
    .toLowerCase()
    .replace(/\[.*?\]/g, '')              // strip PP [Variant] tags
    .replace(/#\s*\d+[a-z]*\s*/g, '')     // strip PP "#NN" number tokens
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

function normalizeNumber(s) {
  if (!s) return ''
  return String(s).toUpperCase().replace(/^0+/, '').replace(/\//g, '').trim()
}

function extractCardNumberFromPpName(name) {
  if (!name) return ''
  const m = name.match(/#\s*(\d+[A-Za-z]*)/)
  return m ? m[1] : ''
}

function normalizeSetName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeLanguage(s) {
  if (!s) return ''
  const v = String(s).toLowerCase().trim()
  if (v === 'jp' || v === 'ja' || v === 'japanese') return 'ja'
  if (v === 'en' || v === 'english') return 'en'
  if (v === 'de' || v === 'german') return 'de'
  if (v === 'es' || v === 'spanish') return 'es'
  if (v === 'fr' || v === 'french') return 'fr'
  if (v === 'it' || v === 'italian') return 'it'
  return v
}

// Printing-kind for sibling-contamination risk evaluation
const VARIANT_PRINTING_KEYS = new Set([
  'pokemon-center', 'prize-pack', 'sparkle', 'staff', 'stamped',
  'jumbo', 'glossy', 'cosmos-holo', 'reverse-holo', 'first-edition',
  'shadowless', 'crystal', 'promo', 'tcg-online', 'parallel',
])

// -------- Fetch everything --------

async function fetchAll(table, select, filters = (q) => q) {
  const out = []
  let from = 0
  const CHUNK = 1000
  while (true) {
    let q = sb.from(table).select(select).range(from, from + CHUNK - 1)
    q = filters(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < CHUNK) break
    from += CHUNK
  }
  return out
}

console.log('[1/5] fetching mappings…')
const mappings = await fetchAll(
  'pokemon_tcg_mappings',
  'id,pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,tcg_printing_key,tcg_set_code,tcg_language,tcg_name,confidence,pricing_eligibility,review_status',
)
console.log(`     ${mappings.length} mappings`)

const tcgCardIds = [...new Set(mappings.map(m => m.tcg_card_id).filter(Boolean))]
console.log(`     ${tcgCardIds.length} unique TCG card IDs`)

console.log('[2/5] fetching provider_cards (image, raw_payload)…')
const providerCards = []
const BATCH = 300
for (let i = 0; i < tcgCardIds.length; i += BATCH) {
  const chunk = tcgCardIds.slice(i, i + BATCH)
  const { data, error } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,tcg_set_code,tcg_set_name,tcg_language,tcg_card_name,tcg_collector_number,image_normal,raw_payload')
    .in('tcg_card_id', chunk)
  if (error) throw new Error(`provider_cards: ${error.message}`)
  providerCards.push(...(data || []))
}
console.log(`     ${providerCards.length} provider_cards rows`)

const providerByKey = new Map()         // key: `${tcg_card_id}|${printing_key}`
const printingsByCard = new Map()       // tcg_card_id → [printing_keys]
const cardMetaById = new Map()          // tcg_card_id → first provider_card row (for name/set/number lookup)
for (const pc of providerCards) {
  providerByKey.set(`${pc.tcg_card_id}|${pc.tcg_printing_key}`, pc)
  if (!printingsByCard.has(pc.tcg_card_id)) printingsByCard.set(pc.tcg_card_id, [])
  printingsByCard.get(pc.tcg_card_id).push(pc.tcg_printing_key)
  if (!cardMetaById.has(pc.tcg_card_id)) cardMetaById.set(pc.tcg_card_id, pc)
}

console.log('[3/5] fetching market price keys…')
const marketKeys = new Set()
let from = 0
while (true) {
  const { data, error } = await sb.from('pokemon_tcg_prices_market')
    .select('tcg_card_id,tcg_printing_key')
    .range(from, from + 999)
  if (error) throw new Error(`prices_market: ${error.message}`)
  if (!data || data.length === 0) break
  for (const r of data) marketKeys.add(`${r.tcg_card_id}|${r.tcg_printing_key}`)
  if (data.length < 1000) break
  from += 1000
}
console.log(`     ${marketKeys.size} unique (card, printing) with ≥1 market row`)

// Build duplicate-mapping index to detect ambiguous_variant
const bySlug = new Map()                      // tcg_card_id → [pp_card_slugs]
for (const m of mappings) {
  if (!m.tcg_card_id) continue
  if (!bySlug.has(m.tcg_card_id)) bySlug.set(m.tcg_card_id, [])
  bySlug.get(m.tcg_card_id).push(m)
}

console.log('[4/5] evaluating each mapping…')

const qaRows = []
const classCounts = {}

for (const m of mappings) {
  const warnings = []
  const evidence = {}

  // Default risk: unverifiable (no match)
  if (!m.tcg_card_id) {
    classCounts.unverifiable = (classCounts.unverifiable || 0) + 1
    qaRows.push({
      mapping_id: m.id, pp_card_slug: m.pp_card_slug, tcg_card_id: null, tcg_printing_key: null,
      risk_class: 'unverifiable',
      prior_pricing_eligibility: m.pricing_eligibility,
      recommended_pricing_eligibility: 'identity_only',
      has_tcgplayer_ref: false, has_cardmarket_ref: false,
      name_exact_match: false, number_exact_match: false, set_match: false,
      language_match: false, image_available: false, market_price_available: false,
      single_printing: false,
      sibling_printings: null,
      evidence: { reason: 'no_tcg_card_id', review_status: m.review_status },
      warnings: ['Mapping has no tcg_card_id'],
    })
    continue
  }

  const pc = providerByKey.get(`${m.tcg_card_id}|${m.tcg_printing_key}`)
  const anyPc = cardMetaById.get(m.tcg_card_id)
  const siblings = printingsByCard.get(m.tcg_card_id) || []
  const singlePrinting = siblings.length === 1
  const hasVariantSibling = siblings.some(k => k !== m.tcg_printing_key && VARIANT_PRINTING_KEYS.has(k))

  // Deterministic checks
  const ppName = normalizeName(m.pp_card_name)
  const tcgName = normalizeName(pc?.tcg_card_name ?? anyPc?.tcg_card_name)
  const nameExactMatch = Boolean(ppName && tcgName && ppName === tcgName)

  const ppNumber = normalizeNumber(extractCardNumberFromPpName(m.pp_card_name))
  const tcgNumber = normalizeNumber(pc?.tcg_collector_number ?? anyPc?.tcg_collector_number)
  const numberExactMatch = Boolean(ppNumber && tcgNumber && (ppNumber === tcgNumber || `${ppNumber}` === `${tcgNumber}`))

  const ppSet = normalizeSetName(m.pp_set_name)
  const tcgSet = normalizeSetName(pc?.tcg_set_name ?? anyPc?.tcg_set_name)
  const setMatch = Boolean(ppSet && tcgSet && (ppSet === tcgSet || ppSet.includes(tcgSet) || tcgSet.includes(ppSet)))

  const ppLang = normalizeLanguage(m.pp_language)
  const tcgLang = normalizeLanguage(pc?.tcg_language ?? m.tcg_language ?? anyPc?.tcg_language)
  const languageMatch = Boolean(ppLang && tcgLang && ppLang === tcgLang)

  const imageAvailable = Boolean(pc?.image_normal || anyPc?.image_normal)
  const marketPriceAvailable = marketKeys.has(`${m.tcg_card_id}|${m.tcg_printing_key}`)

  // External marketplace IDs → independent evidence
  const ext = pc?.raw_payload?.external_ids || null
  const hasTcgplayerRef = Boolean(ext?.tcgplayerId || ext?.tcgplayer_id)
  const hasCardmarketRef = Boolean(ext?.cardmarketId || ext?.cardmarket_id)

  evidence.pp = { name: m.pp_card_name, set: m.pp_set_name, language: m.pp_language, extracted_number: ppNumber }
  evidence.tcg = { name: pc?.tcg_card_name ?? anyPc?.tcg_card_name ?? null, set: pc?.tcg_set_name ?? anyPc?.tcg_set_name ?? null, language: tcgLang, collector_number: tcgNumber, printing_key: m.tcg_printing_key, card_id: m.tcg_card_id }
  evidence.external_ids = ext
  evidence.sibling_printings = siblings

  // --- Risk classification ---
  let risk = null

  // Ambiguous: >1 PP mapping points at same tcg_card_id (likely one of them is a missed variant)
  const otherMappings = (bySlug.get(m.tcg_card_id) || []).filter(x => x.id !== m.id)
  if (otherMappings.length > 0) {
    const theyShareSamePrinting = otherMappings.some(x => x.tcg_printing_key === m.tcg_printing_key)
    if (theyShareSamePrinting) {
      // Both PP cards claim the same (card, printing) → duplicate target
      risk = 'ambiguous_variant'
      warnings.push(`Shared target: ${otherMappings.length} other PP card(s) map to same (${m.tcg_card_id}, ${m.tcg_printing_key})`)
    }
  }

  // Conflicting identity: hard mismatch on name OR number OR set
  if (!risk) {
    const identityFailures = []
    if (!nameExactMatch && ppName && tcgName) identityFailures.push(`name:'${ppName}'≠'${tcgName}'`)
    if (!numberExactMatch && ppNumber && tcgNumber) identityFailures.push(`number:${ppNumber}≠${tcgNumber}`)
    if (!setMatch && ppSet && tcgSet) identityFailures.push(`set:'${ppSet}'≠'${tcgSet}'`)
    if (identityFailures.length >= 2) {
      risk = 'conflicting_identity'
      warnings.push(`Identity conflicts: ${identityFailures.join(' · ')}`)
    } else if (identityFailures.length === 1) {
      warnings.push(`Minor mismatch: ${identityFailures[0]}`)
    }
  }

  // Pricing restriction: multi-printing graded unsafe
  if (!risk) {
    if (m.pricing_eligibility === 'bulk_safe' && !singlePrinting) {
      risk = 'pricing_restriction'
      if (hasVariantSibling) {
        warnings.push(`Multi-printing with variant sibling: card has [${siblings.join(', ')}] — card-level graded aggregate is contaminated`)
      } else {
        warnings.push(`Multi-printing (${siblings.length} printings) — card-level graded aggregate pools across all printings`)
      }
    }
  }

  // Verified independent: name+number+set+language all match + market exists + single printing (or already graded-ineligible) + external ref present
  if (!risk) {
    const identityClean = nameExactMatch && numberExactMatch && setMatch && languageMatch
    const gradedSafe = singlePrinting || m.pricing_eligibility !== 'bulk_safe'
    if (identityClean && imageAvailable && marketPriceAvailable && gradedSafe && (hasTcgplayerRef || hasCardmarketRef)) {
      risk = 'verified_independent'
    }
  }

  // Internally consistent fallback: identity passes but no independent corroboration
  if (!risk) {
    const identityClean = nameExactMatch && numberExactMatch && setMatch && languageMatch
    if (identityClean && imageAvailable) {
      if (marketPriceAvailable) {
        risk = 'internally_consistent'
      } else {
        risk = 'pricing_restriction'
        warnings.push('No market price row — cannot verify provider has active TCGplayer/Cardmarket feed')
      }
    }
  }

  if (!risk) {
    risk = 'unverifiable'
    warnings.push('Identity checks did not pass')
  }

  // Recommend corrected pricing_eligibility
  let rec = m.pricing_eligibility
  if (risk === 'pricing_restriction') {
    if (!singlePrinting && m.pricing_eligibility === 'bulk_safe') rec = 'market_only'
    else if (!marketPriceAvailable) rec = 'identity_only'
  } else if (risk === 'conflicting_identity' || risk === 'ambiguous_variant' || risk === 'unverifiable') {
    rec = m.pricing_eligibility === 'bulk_safe' ? 'identity_only' : (m.pricing_eligibility || 'identity_only')
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

console.log('[5/5] writing QA rows to Supabase + summary file…')

// Write in chunks
let written = 0
for (let i = 0; i < qaRows.length; i += 500) {
  const chunk = qaRows.slice(i, i + 500)
  const { error } = await sb.from('pokemon_tcg_mapping_qa').upsert(chunk, { onConflict: 'mapping_id' })
  if (error) throw new Error(`upsert QA at ${i}: ${error.message}`)
  written += chunk.length
  if (i % 5000 === 0) console.log(`     wrote ${written}…`)
}
console.log(`     wrote ${written} QA rows`)

const summary = {
  mappings_total: mappings.length,
  risk_classes: classCounts,
  prior_eligibility_distribution: {},
  recommended_eligibility_distribution: {},
  downgrades: { bulk_safe_to_market_only: 0, bulk_safe_to_identity_only: 0 },
  independent_evidence: {
    with_tcgplayer_ref: 0,
    with_cardmarket_ref: 0,
    with_either_ref: 0,
  },
}
for (const r of qaRows) {
  summary.prior_eligibility_distribution[r.prior_pricing_eligibility || 'null'] =
    (summary.prior_eligibility_distribution[r.prior_pricing_eligibility || 'null'] || 0) + 1
  summary.recommended_eligibility_distribution[r.recommended_pricing_eligibility || 'null'] =
    (summary.recommended_eligibility_distribution[r.recommended_pricing_eligibility || 'null'] || 0) + 1
  if (r.prior_pricing_eligibility === 'bulk_safe' && r.recommended_pricing_eligibility === 'market_only')
    summary.downgrades.bulk_safe_to_market_only++
  if (r.prior_pricing_eligibility === 'bulk_safe' && r.recommended_pricing_eligibility === 'identity_only')
    summary.downgrades.bulk_safe_to_identity_only++
  if (r.has_tcgplayer_ref) summary.independent_evidence.with_tcgplayer_ref++
  if (r.has_cardmarket_ref) summary.independent_evidence.with_cardmarket_ref++
  if (r.has_tcgplayer_ref || r.has_cardmarket_ref) summary.independent_evidence.with_either_ref++
}

writeFileSync('scripts/_pp-tcg-match-qa/qa-summary.json', JSON.stringify(summary, null, 2))

console.log('\n=== Risk class distribution ===')
for (const [k, v] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(26)} ${v}`)
}
console.log('\n=== Recommended eligibility ===')
for (const [k, v] of Object.entries(summary.recommended_eligibility_distribution).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`)
}
console.log('\n=== Independent evidence ===')
console.log(`  with TCGplayer ref:  ${summary.independent_evidence.with_tcgplayer_ref} (${(summary.independent_evidence.with_tcgplayer_ref / qaRows.length * 100).toFixed(1)}%)`)
console.log(`  with Cardmarket ref: ${summary.independent_evidence.with_cardmarket_ref} (${(summary.independent_evidence.with_cardmarket_ref / qaRows.length * 100).toFixed(1)}%)`)
console.log(`  with either ref:     ${summary.independent_evidence.with_either_ref} (${(summary.independent_evidence.with_either_ref / qaRows.length * 100).toFixed(1)}%)`)
console.log('\n=== Downgrades ===')
console.log(`  bulk_safe → market_only:  ${summary.downgrades.bulk_safe_to_market_only}`)
console.log(`  bulk_safe → identity_only: ${summary.downgrades.bulk_safe_to_identity_only}`)

console.log('\n[done]')
