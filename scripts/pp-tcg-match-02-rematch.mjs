// PP-TCG-MATCH-02: enhanced matcher.
//
// Reads the saved TCGGraph catalogue + the PP cards. Regenerates
// candidates + mapping confidence + pricing_eligibility using three
// additional heuristics beyond the 01A matcher:
//
//   • Promo distribution routing: PP's broad "Promo" / "Black Star"
//     / "Championship" / "Japanese Promo" buckets probe each
//     TCGGraph promo-set code individually (basep, dpp, xyp, smp,
//     svp, bkp, kwbp, np, wcd20xx, lcc). A unique set+number match
//     within a promo set is promoted to verified.
//
//   • Global uniqueness promotion: if a PP card's (clean_name,
//     collector_number, language) matches exactly ONE TCG card
//     across the whole catalogue, the match is promoted to
//     verified — even if PP's set_name didn't resolve to a TCG
//     set code via alias. Pricing eligibility is still gated on
//     variant-tag + printing-key.
//
//   • Topps / McDonalds / Burger King / 1999 Topps TV routing:
//     these PP sets are not Pokémon TCG proper. We mark them as
//     no_tcg_equivalent + not_eligible rather than letting them
//     fall into "unmatched" and clutter the review queue.
//
// All of this is deterministic, auditable (reasons stored on each
// candidate), and reversible (candidate rows regenerable; approved
// rows are never overwritten).

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co'
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc'
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } })

const PROVIDER = 'tcggraph'
const CATALOGUE_VERSION = '2026-10-18-pp-tcg-match-02'

const en = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-en.json', 'utf-8'))
const ja = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-ja.json', 'utf-8'))
const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))
const tcgCards = [...en.rows, ...ja.rows]
console.log(`[inputs] ${en.rows.length} EN + ${ja.rows.length} JA = ${tcgCards.length} TCG cards; ${sets.length} sets`)

// ---------- Normalisation ----------
function normStr(s) { return (s || '').toLowerCase().replace(/[^\w]/g, '').trim() }
function normName(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() }
function normNum(s) {
  const str = String(s ?? '').trim()
  if (/^0+\d+$/.test(str)) return str.replace(/^0+/, '')
  return str.toLowerCase()
}
function cleanName(s) {
  if (!s) return ''
  return s.replace(/\s*#\s*[A-Za-z0-9\-\/]+\s*$/i, '')
          .replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ').trim()
}
function extractVariantTag(s) {
  const m = (s || '').match(/\[([^\]]+)\]/)
  return m && m[1] ? m[1].trim() : null
}

const PP_LANG_TO_TCG = { en: 'en', jp: 'ja' }
const PP_TAG_TO_PRINTING_KEY = {
  '1st Edition': '1st-edition', '1st Edition Foil': '1st-edition-foil',
  'Shadowless': 'shadowless', 'Reverse Holo': 'reverse-holo', 'Reverse': 'reverse-holo',
  'Holo': 'foil', 'Foil': 'foil', 'Cosmos Holo': 'cosmos-holo',
  'Master Ball': 'masterball', 'Poke Ball': 'pokeball', 'Pokeball': 'pokeball',
  'Dusk Ball': 'duskball', 'Love Ball': 'loveball', 'Friend Ball': 'friendball',
  'Quick Ball': 'quickball', 'Team Rocket': 'team-rocket', 'Staff': 'staff',
  'Prerelease': 'prerelease', 'League': 'league', 'Pokemon Center': 'pokemon-center',
  'Energy Symbol': 'energy-symbol', 'Cracked Ice': 'cracked-ice',
}
const KNOWN_UNSUPPORTED = new Set([
  'Mirror Holo', 'Jumbo', 'Prize Pack', 'Rainbow Foil', 'Stamped', 'Prism', 'Gold Star',
  'Sparkle', 'Tekno', 'Prize Pack Cosmos Holo', 'Glossy Prism', 'Holo Prism', 'Silver Foil',
])
const PROMO_REPRINT_CARD_ID = /_promo|wcd\d|_jumbo|_prize|_sparkle|_tekno/i

function expectedPrintingKey(variantTag, isFirstEdSet, isShadowless) {
  if (!variantTag) {
    if (isFirstEdSet) return '1st-edition'
    if (isShadowless) return 'shadowless'
    return 'normal'
  }
  if (KNOWN_UNSUPPORTED.has(variantTag)) return null
  return PP_TAG_TO_PRINTING_KEY[variantTag] || null
}

// ---------- TCG promo sets ----------
// Enumerated from the saved sets.json. These are the sets that PP's
// broad "Promo" / "Black Star" / "Championship" rows should route to.

const TCG_PROMO_SETS = sets.filter(s =>
  /Promo|Black Star|Championship|League|Prerelease/i.test(s.name || '')
).map(s => ({ code: s.code, name: s.name, language: s.language, releasedAt: s.releasedAt }))

console.log(`[promo] TCG promo-specific sets: ${TCG_PROMO_SETS.length}`)

function ppSetIsPromoBucket(ppSetName) {
  return /^(Japanese )?(Promo|Black Star|World Championships|Prerelease|League)$/i.test(ppSetName || '')
      || /^(Japanese )?Promo /.test(ppSetName || '')
      || /\bPromo\b/.test(ppSetName || '')
}
function ppSetIsNonTcg(ppSetName) {
  return /^(1999 Topps|2000 Topps|Topps Chrome|Topps TV|Burger King|McDonalds|Best of Game)/i.test(ppSetName || '')
}

// ---------- Build indices ----------
console.log('[index] building TCG indices...')
const tcgById = new Map(tcgCards.map(c => [c.id, c]))
const bySetNumLang = new Map()
const byNameNumLang = new Map()
for (const c of tcgCards) {
  const sk = `${c.set_code}|${normNum(c.collectorNumber)}|${c.language}`
  if (!bySetNumLang.has(sk)) bySetNumLang.set(sk, [])
  bySetNumLang.get(sk).push(c)

  const nk = `${normName(c.name)}|${normNum(c.collectorNumber)}|${c.language}`
  if (!byNameNumLang.has(nk)) byNameNumLang.set(nk, [])
  byNameNumLang.get(nk).push(c)
}
const setByNormName = new Map()
for (const s of sets) {
  const key = `${normStr(s.name)}|${s.language}`
  if (!setByNormName.has(key)) setByNormName.set(key, [])
  setByNormName.get(key).push(s)
}
const reprintsOf = new Map()
for (const c of tcgCards) {
  if (c.baseCardId) {
    if (!reprintsOf.has(c.baseCardId)) reprintsOf.set(c.baseCardId, [])
    reprintsOf.get(c.baseCardId).push(c)
  }
}

// ---------- Load set aliases ----------
async function loadAliases() {
  const { data, error } = await sb.from('pokemon_tcg_set_aliases').select('pp_set_name, pp_language, tcg_set_code, tcg_language')
  if (error) throw new Error(error.message)
  const map = new Map()
  for (const r of data || []) {
    const key = `${normStr(r.pp_set_name)}|${r.pp_language}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ tcg_set_code: r.tcg_set_code, tcg_language: r.tcg_language })
  }
  console.log(`[aliases] ${data?.length ?? 0} loaded`)
  return map
}

// ---------- Matcher v2 ----------
function matchPp(ppCard, aliasMap) {
  const ppLang = ppCard.language === 'jp' ? 'jp' : 'en'
  const tcgLang = PP_LANG_TO_TCG[ppLang]
  const strippedSet = (ppCard.set_name || '').replace(/^Japanese /i, '').trim()
  const setKey = `${normStr(strippedSet)}|${ppLang}`
  const variantTag = extractVariantTag(ppCard.card_name)
  const cleanedName = cleanName(ppCard.card_name)
  const num = normNum(ppCard.card_number)
  const hasFirstEdInSet = /1st edition/i.test(ppCard.set_name || '')
  const hasShadowless = /shadowless/i.test(ppCard.set_name || '')
  const expectedKey = expectedPrintingKey(variantTag, hasFirstEdInSet, hasShadowless)

  // Early short-circuit: non-TCG sets have no equivalent
  if (ppSetIsNonTcg(ppCard.set_name)) {
    return {
      candidates: [],
      top_match: 'non_tcg',
      top_confidence: null,
      forced_status: 'no_tcg_equivalent',
      needs_review_reason: `set "${ppCard.set_name}" is Topps / BK / McDonalds — no Pokémon TCG counterpart`,
      expectedKey,
      variantTag,
    }
  }

  const candidates = []
  const seenIds = new Set()
  function push(card, { method, confidence, reasons, printingKey }) {
    const id = `${card.id}|${printingKey || 'normal'}`
    if (seenIds.has(id)) return
    seenIds.add(id)
    const printing = (card.printings || []).find(p => p.key === (printingKey || 'normal'))
                   || (card.printings || [])[0]
    candidates.push({ card, printing, printingKey: printing?.key || 'normal', method, confidence, reasons })
  }

  // ---------- Pass 1: set alias / implicit set lookup ----------
  const aliases = aliasMap.get(setKey) || []
  const codes = aliases.map(a => a.tcg_set_code)
  const implicitSets = setByNormName.get(`${normStr(strippedSet)}|${tcgLang}`) || []
  for (const s of implicitSets) if (!codes.includes(s.code)) codes.push(s.code)

  for (const code of codes) {
    const key = `${code}|${num}|${tcgLang}`
    for (const r of (bySetNumLang.get(key) || [])) {
      const nameMatches = normName(r.name) === normName(cleanedName)
      push(r, {
        method: aliases.find(a => a.tcg_set_code === code) ? 'set_alias' : 'exact',
        confidence: nameMatches ? 'high' : 'medium',
        reasons: [`set=${code}`, `collector=${num}`, nameMatches ? 'name match' : `name mismatch (pp="${cleanedName}" vs tcg="${r.name}")`],
        printingKey: expectedKey || 'normal',
      })
    }
  }

  // ---------- Pass 2: promo distribution routing ----------
  // If PP card is in a broad promo bucket and we didn't match via Pass 1,
  // probe every TCG promo set code for the same collector number.
  if (candidates.length === 0 && ppSetIsPromoBucket(ppCard.set_name)) {
    for (const ps of TCG_PROMO_SETS) {
      if (ps.language !== tcgLang) continue
      const key = `${ps.code}|${num}|${tcgLang}`
      for (const r of (bySetNumLang.get(key) || [])) {
        const nameMatches = normName(r.name) === normName(cleanedName)
        push(r, {
          method: 'promo_distribution',
          confidence: nameMatches ? 'high' : 'medium',
          reasons: [`promo_set=${ps.code} (${ps.name})`, `collector=${num}`, nameMatches ? 'name match' : 'name mismatch'],
          printingKey: expectedKey || 'normal',
        })
      }
    }
  }

  // ---------- Pass 3: global name+number uniqueness ----------
  // Even without a set resolution, a name+number+language that matches
  // exactly ONE TCG card is a deterministic identity match.
  if (candidates.length === 0) {
    const key = `${normName(cleanedName)}|${num}|${tcgLang}`
    const rows = byNameNumLang.get(key) || []
    for (const r of rows) {
      push(r, {
        method: rows.length === 1 ? 'global_unique' : 'name_number',
        confidence: rows.length === 1 ? 'high' : 'low',
        reasons: [`no set resolved`, `name+collector=${num}`, rows.length === 1 ? 'globally unique' : `${rows.length} candidates`],
        printingKey: expectedKey || 'normal',
      })
    }
  }

  // ---------- Pass 4: baseCardId reprint info ----------
  if (candidates.length > 0) {
    const primary = candidates[0]
    for (const rc of (reprintsOf.get(primary.card.id) || [])) {
      push(rc, {
        method: 'basecard_reprint',
        confidence: 'low',
        reasons: [`reprint of ${primary.card.id}`, `set=${rc.set_code}`],
        printingKey: 'normal',
      })
    }
  }

  // ---------- Score + decide ----------
  const scored = candidates.map(c => ({
    ...c, _score: ({ verified: 4, high: 3, medium: 2, low: 1 })[c.confidence] ?? 0,
  })).sort((a, b) => b._score - a._score)

  // Promote to verified when EXACTLY ONE high-confidence candidate exists,
  // regardless of whether it came from pass 1, 2 or 3.
  const highOnly = scored.filter(s => s.confidence === 'high')
  let top_confidence
  if (highOnly.length === 1) top_confidence = 'verified'
  else if (highOnly.length > 1) top_confidence = 'medium'
  else top_confidence = scored[0]?.confidence || null

  const top_match = scored[0]?.method || null
  const needs_review_reason =
    top_confidence === 'verified' ? null
    : highOnly.length > 1 ? `${highOnly.length} TCG candidates at exact match level — ambiguous`
    : top_confidence === 'medium' ? `set resolution partial; name or printing differs`
    : top_confidence === 'low' ? `only low-confidence candidates (multiple name/number matches, no set resolution)`
    : scored.length === 0 ? `no TCG candidates found for this card`
    : null

  return {
    candidates: scored,
    top_match,
    top_confidence,
    forced_status: null,
    needs_review_reason,
    expectedKey,
    variantTag,
  }
}

// ---------- Pricing eligibility (same as 01A) ----------
function classifyEligibility({ review_status, confidence, tcg_card_id, tcg_printing_key, tcg_language, pp_language, pp_card_name, shares_clash }) {
  if (['rejected','no_tcg_equivalent','unmatched'].includes(review_status) || !tcg_card_id) return 'not_eligible'
  const tag = extractVariantTag(pp_card_name)
  const expectedKey = tag
    ? (KNOWN_UNSUPPORTED.has(tag) ? null : (PP_TAG_TO_PRINTING_KEY[tag] ?? null))
    : 'normal'
  if (confidence !== 'verified') return 'uncertain'
  if (tag && KNOWN_UNSUPPORTED.has(tag)) return 'identity_only'
  if (tag && !PP_TAG_TO_PRINTING_KEY[tag]) return 'identity_only'
  if (tag && expectedKey && tcg_printing_key && tcg_printing_key !== expectedKey) return 'identity_only'
  const expectedLang = pp_language === 'jp' ? 'ja' : 'en'
  if (tcg_language && tcg_language !== expectedLang) return 'identity_only'
  if (PROMO_REPRINT_CARD_ID.test(tcg_card_id)) return 'identity_only'
  if (shares_clash) return 'identity_only'
  if (tag && expectedKey && expectedKey !== 'normal') return 'market_only'
  return 'bulk_safe'
}

// ---------- Pull PP cards ----------
async function pullPpCards() {
  console.log('[pp] pulling cards...')
  const all = []
  let offset = 0
  const PAGE = 1000
  while (offset < 100000) {
    const { data, error } = await sb.from('cards')
      .select('id, card_slug, card_name, set_name, card_number, language, card_url_slug, set_release_date, image_url')
      .eq('is_sealed', false).order('id').range(offset, offset + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`[pp] ${all.length} cards`)
  return all
}

// ---------- Run ----------
const aliasMap = await loadAliases()
const ppCards = await pullPpCards()

console.log('[match] generating candidates (pass 1-4)...')
const matched = ppCards.map(pp => ({ pp, r: matchPp(pp, aliasMap) }))

// Pre-compute clash set
const clashKeys = new Set()
{
  const target = new Map()
  for (const { r } of matched) {
    const top = r.candidates[0]
    if (!top) continue
    if (r.top_confidence !== 'verified') continue
    const k = `${top.card.id}|${top.printingKey}`
    target.set(k, (target.get(k) || 0) + 1)
  }
  for (const [k, n] of target.entries()) if (n > 1) clashKeys.add(k)
}
console.log(`[clash] ${clashKeys.size} TCG targets shared by >1 PP slug`)

// ---------- Build rows ----------
const beforeState = await (async () => {
  const { data } = await sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, confidence, review_status, pricing_eligibility, pp_set_name, pp_language')
  const map = new Map()
  for (const r of (data || [])) map.set(r.pp_card_slug, r)
  return map
})()

const mappingRows = []
const candidateRows = []
const statusCounts = {}
const eligCounts = { bulk_safe: 0, market_only: 0, identity_only: 0, not_eligible: 0, uncertain: 0 }
const beforeAfter = { promos: {}, en: {}, ja: {}, vintage: {} }

for (const { pp, r } of matched) {
  const top = r.candidates[0] || null
  const previous = beforeState.get(pp.card_slug)
  const alreadyApproved = previous?.review_status === 'approved'

  // Decide review_status
  let review_status
  if (alreadyApproved) {
    review_status = 'approved'    // never overwrite operator approvals
  } else if (r.forced_status) {
    review_status = r.forced_status
  } else if (!top) {
    review_status = 'unmatched'
  } else {
    review_status = 'pending_review'
  }

  const top_tcg_id = top?.card.id || null
  const top_printing = top?.printingKey || null
  const shares_clash = top_tcg_id ? clashKeys.has(`${top_tcg_id}|${top_printing}`) : false
  const pricing_eligibility = classifyEligibility({
    review_status, confidence: r.top_confidence,
    tcg_card_id: top_tcg_id, tcg_printing_key: top_printing,
    tcg_language: top?.card.language, pp_language: pp.language,
    pp_card_name: pp.card_name, shares_clash,
  })

  statusCounts[review_status] = (statusCounts[review_status] || 0) + 1
  eligCounts[pricing_eligibility] = (eligCounts[pricing_eligibility] || 0) + 1

  // Before/after tracking per cohort
  const bucket =
    /Promo|Black Star|Championship/i.test(pp.set_name || '') ? 'promos'
    : pp.language === 'jp' ? 'ja'
    : /^(Base Set|Jungle|Fossil|Base Set 2|Team Rocket|Gym Heroes|Gym Challenge|Neo )/.test(pp.set_name || '') ? 'vintage'
    : 'en'
  const beforeConf = previous?.confidence || 'none'
  beforeAfter[bucket][`before_${beforeConf}`] = (beforeAfter[bucket][`before_${beforeConf}`] || 0) + 1
  beforeAfter[bucket][`after_${r.top_confidence || 'none'}`] = (beforeAfter[bucket][`after_${r.top_confidence || 'none'}`] || 0) + 1

  // Mapping row (one per PP card)
  mappingRows.push({
    provider: PROVIDER,
    pp_card_slug: pp.card_slug,
    pp_set_name: pp.set_name,
    pp_card_name: pp.card_name,
    pp_language: pp.language,
    tcg_card_id: top_tcg_id,
    tcg_printing_key: top_printing || null,
    tcg_price_card_id: top?.printing?.cardId || top_tcg_id,
    tcg_set_code: top?.card.set_code || null,
    tcg_language: top?.card.language || null,
    tcg_name: top?.card.name || null,
    match_method: alreadyApproved ? previous?.match_method : (top?.method || null),
    confidence: alreadyApproved ? previous?.confidence : (r.top_confidence || null),
    review_status,
    pricing_eligibility: alreadyApproved ? previous?.pricing_eligibility || pricing_eligibility : pricing_eligibility,
    notes: r.needs_review_reason || null,
    catalogue_version: CATALOGUE_VERSION,
  })

  // Candidate rows (all alternatives)
  for (const c of r.candidates.slice(0, 5)) {
    candidateRows.push({
      provider: PROVIDER,
      pp_card_slug: pp.card_slug,
      tcg_card_id: c.card.id,
      tcg_printing_key: c.printingKey || 'normal',
      tcg_price_card_id: c.printing?.cardId || c.card.id,
      tcg_set_code: c.card.set_code,
      tcg_language: c.card.language,
      tcg_collector_num: c.card.collectorNumber,
      tcg_name: c.card.name,
      match_method: c.method,
      confidence: c.confidence,
      reasons: c.reasons,
      conflicts: r.candidates.length > 1 ? ['multiple_candidates'] : [],
      snapshot_prices: {
        tcgplayer_normal_usd: c.card.tcgplayer_usd,
        cardmarket_normal_eur: c.card.cardmarket_eur,
        psa10_usd: c.card.psa10_usd,
        pooled9_usd: c.card.pooled9_usd,
        pooled95_usd: c.card.pooled95_usd,
        raw_ungraded_usd: c.card.raw_usd,
      },
      catalogue_version: CATALOGUE_VERSION,
    })
  }
}

// Dedupe candidates
const seen = new Set()
const dedupCandidates = []
for (const c of candidateRows) {
  const k = `${c.provider}|${c.pp_card_slug}|${c.tcg_card_id}|${c.tcg_printing_key}`
  if (seen.has(k)) continue
  seen.add(k); dedupCandidates.push(c)
}
console.log(`[rows] mappings: ${mappingRows.length}, candidates: ${dedupCandidates.length}`)
console.log(`[status]`, statusCounts)
console.log(`[eligibility]`, eligCounts)

// ---------- Save for inspection + bulk upsert ----------
writeFileSync('scripts/_pp-tcg-match-02/rematch-summary.json', JSON.stringify({
  statusCounts, eligCounts, beforeAfter, total: mappingRows.length,
  verified_count: mappingRows.filter(r => r.confidence === 'verified').length,
  non_tcg_cohort: mappingRows.filter(r => r.review_status === 'no_tcg_equivalent').length,
}, null, 2))

console.log('[write] upserting mappings...')
const BATCH = 500
for (let i = 0; i < mappingRows.length; i += BATCH) {
  const chunk = mappingRows.slice(i, i + BATCH)
  const { error } = await sb.from('pokemon_tcg_mappings').upsert(chunk, { onConflict: 'provider,pp_card_slug' })
  if (error) throw new Error(`mapping chunk ${i}: ${error.message}`)
  if ((i / BATCH) % 10 === 0) console.log(`  mappings ${i + chunk.length}/${mappingRows.length}`)
}

// Candidates: delete + reinsert for a clean regenerate (pricing eligibility and candidate shape may have changed)
console.log('[write] regenerating candidates...')
await sb.from('pokemon_tcg_mapping_candidates').delete().eq('provider', PROVIDER).neq('id', '00000000-0000-0000-0000-000000000000')
for (let i = 0; i < dedupCandidates.length; i += BATCH) {
  const chunk = dedupCandidates.slice(i, i + BATCH)
  const { error } = await sb.from('pokemon_tcg_mapping_candidates').insert(chunk)
  if (error) throw new Error(`candidate chunk ${i}: ${error.message}`)
  if ((i / BATCH) % 10 === 0) console.log(`  candidates ${i + chunk.length}/${dedupCandidates.length}`)
}

console.log('\n[DONE]')
console.log('status:', statusCounts)
console.log('elig:', eligCounts)
console.log('→ scripts/_pp-tcg-match-02/rematch-summary.json')
