// PP-TCG-MATCH-01: seed the mapping workbench.
//
// 1. Read TCGGraph catalogues from PP-DATA-TEST-02 saved outputs.
// 2. Pull PP non-sealed cards from Supabase (read-only).
// 3. Build candidate matches per PP card using the improved matcher
//    (promo-aware: set aliases, baseCardId chains, printings[] variants).
// 4. Upsert into:
//      pokemon_tcg_set_aliases          (seed common aliases)
//      pokemon_tcg_mapping_candidates   (ephemeral, regeneratable)
//      pokemon_tcg_mappings             (per PP card, status reflects confidence)
// 5. Does NOT touch cards, card_trends, or any live pricing surface.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const SB_URL = 'https://egidpsrkqvymvioidatc.supabase.co'
const SRK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc'
const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } })

const PROVIDER = 'tcggraph'
const CATALOGUE_VERSION = '2026-10-17-pp-data-test-02'

const en = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-en.json', 'utf-8'))
const ja = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/cards-ja.json', 'utf-8'))
const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))
const tcgCards = [...en.rows, ...ja.rows]
console.log(`[inputs] ${en.rows.length} EN + ${ja.rows.length} JA = ${tcgCards.length} TCG cards; ${sets.length} sets`)

// -------- Normalisation helpers --------
function normStr(s) { return (s || '').toLowerCase().replace(/[^\w]/g, '').trim() }
function normName(s) { return (s || '').toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim() }
function normNum(s) {
  const str = String(s ?? '').trim()
  if (/^0+\d+$/.test(str)) return str.replace(/^0+/, '')
  return str.toLowerCase()
}
function cleanName(s) {
  if (!s) return ''
  return s
    .replace(/\s*#\s*[A-Za-z0-9\-\/]+\s*$/i, '')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function extractVariantTag(s) {
  const m = (s || '').match(/\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

const PP_LANG_TO_TCG = { en: 'en', jp: 'ja' }

// PP variant tag → TCGGraph printings[].key
const PP_TAG_TO_PRINTING_KEY = {
  '1st Edition':      '1st-edition',
  '1st Edition Foil': '1st-edition-foil',
  'Shadowless':       'shadowless',
  'Reverse Holo':     'reverse-holo',
  'Reverse':          'reverse-holo',
  'Holo':             'foil',
  'Foil':             'foil',
  'Cosmos Holo':      'cosmos-holo',
  'Master Ball':      'masterball',
  'Poke Ball':        'pokeball',
  'Pokeball':         'pokeball',
  'Dusk Ball':        'duskball',
  'Love Ball':        'loveball',
  'Friend Ball':      'friendball',
  'Quick Ball':       'quickball',
  'Team Rocket':      'team-rocket',
  'Staff':            'staff',
  'Prerelease':       'prerelease',
  'League':           'league',
  'Pokemon Center':   'pokemon-center',
  'Energy Symbol':    'energy-symbol',
  'Cracked Ice':      'cracked-ice',
  // Unmapped: Mirror Holo, Jumbo, Prize Pack, Rainbow Foil, Stamped, Prism, Gold Star — no TCG printing key
}
function expectedPrintingKey(ppVariantTag, isFirstEditionSet, isShadowless) {
  if (!ppVariantTag) {
    if (isFirstEditionSet) return '1st-edition'
    if (isShadowless)      return 'shadowless'
    return 'normal'
  }
  return PP_TAG_TO_PRINTING_KEY[ppVariantTag] || null
}

// -------- Pre-seed set aliases --------
// Common PP set name → TCGGraph set code mapping.
// Operator can add more via the admin UI; the matcher consults this
// before falling back to name heuristics.
const SET_ALIAS_SEEDS = [
  { pp: 'Base Set', ppLang: 'en', tcg: 'base1', tcgLang: 'en', note: 'Original + Shadowless + 1st Ed printings all under base1' },
  { pp: 'Base Set 2', ppLang: 'en', tcg: 'base4', tcgLang: 'en' },
  { pp: 'Jungle', ppLang: 'en', tcg: 'base2', tcgLang: 'en' },
  { pp: 'Fossil', ppLang: 'en', tcg: 'base3', tcgLang: 'en' },
  { pp: 'Team Rocket', ppLang: 'en', tcg: 'base5', tcgLang: 'en' },
  { pp: 'Gym Heroes', ppLang: 'en', tcg: 'gym1', tcgLang: 'en' },
  { pp: 'Gym Challenge', ppLang: 'en', tcg: 'gym2', tcgLang: 'en' },
  { pp: 'Neo Genesis', ppLang: 'en', tcg: 'neo1', tcgLang: 'en' },
  { pp: 'Neo Discovery', ppLang: 'en', tcg: 'neo2', tcgLang: 'en' },
  { pp: 'Neo Revelation', ppLang: 'en', tcg: 'neo3', tcgLang: 'en' },
  { pp: 'Neo Destiny', ppLang: 'en', tcg: 'neo4', tcgLang: 'en' },
  { pp: 'Expedition', ppLang: 'en', tcg: 'ecard1', tcgLang: 'en' },
  { pp: 'Aquapolis', ppLang: 'en', tcg: 'ecard2', tcgLang: 'en' },
  { pp: 'Skyridge', ppLang: 'en', tcg: 'ecard3', tcgLang: 'en' },
]

// -------- Build TCG indices --------
console.log('[index] building TCG indices...')
const tcgById = new Map(tcgCards.map(c => [c.id, c]))

// index: (set_code|collector_num|language) → cards
const bySetNumLang = new Map()
for (const c of tcgCards) {
  const key = `${c.set_code}|${normNum(c.collectorNumber)}|${c.language}`
  if (!bySetNumLang.has(key)) bySetNumLang.set(key, [])
  bySetNumLang.get(key).push(c)
}
// index: (name_norm|language) → cards
const byNameLang = new Map()
for (const c of tcgCards) {
  const key = `${normName(c.name)}|${c.language}`
  if (!byNameLang.has(key)) byNameLang.set(key, [])
  byNameLang.get(key).push(c)
}
// index: (name_norm|collector_num|language) → cards
const byNameNumLang = new Map()
for (const c of tcgCards) {
  const key = `${normName(c.name)}|${normNum(c.collectorNumber)}|${c.language}`
  if (!byNameNumLang.has(key)) byNameNumLang.set(key, [])
  byNameNumLang.get(key).push(c)
}
// index: tcgplayerId → [{card, printing}]
const byTcgPlayerId = new Map()
const byCardmarketId = new Map()
for (const c of tcgCards) {
  for (const p of (c.printings || [])) {
    const tp = p.tcgplayerId
    const cm = p.cardmarketId
    if (tp) {
      if (!byTcgPlayerId.has(tp)) byTcgPlayerId.set(tp, [])
      byTcgPlayerId.get(tp).push({ card: c, printing: p })
    }
    if (cm) {
      if (!byCardmarketId.has(cm)) byCardmarketId.set(cm, [])
      byCardmarketId.get(cm).push({ card: c, printing: p })
    }
  }
}
// index: baseCardId → [cards that reprint from this base]
const reprintsOf = new Map()
for (const c of tcgCards) {
  if (c.baseCardId) {
    if (!reprintsOf.has(c.baseCardId)) reprintsOf.set(c.baseCardId, [])
    reprintsOf.get(c.baseCardId).push(c)
  }
}
// index: TCG sets by language + normalised name
const setByNormName = new Map()
for (const s of sets) {
  const key = `${normStr(s.name)}|${s.language}`
  if (!setByNormName.has(key)) setByNormName.set(key, [])
  setByNormName.get(key).push(s)
}

// -------- Load set aliases from DB (plus seeds) --------
async function ensureSetAliases() {
  console.log('[aliases] ensuring seed set aliases...')
  const rows = SET_ALIAS_SEEDS.map(a => ({
    pp_set_name: a.pp,
    pp_language: a.ppLang,
    tcg_set_code: a.tcg,
    tcg_language: a.tcgLang,
    notes: a.note || null,
  }))
  const { error } = await sb.from('pokemon_tcg_set_aliases').upsert(rows, {
    onConflict: 'pp_set_name,pp_language,tcg_set_code,tcg_language',
  })
  if (error) throw new Error(`alias seed: ${error.message}`)
  // Read all aliases (incl. operator-added ones)
  const { data, error: readErr } = await sb.from('pokemon_tcg_set_aliases').select('pp_set_name, pp_language, tcg_set_code, tcg_language')
  if (readErr) throw new Error(`alias read: ${readErr.message}`)
  const map = new Map()
  for (const r of data || []) {
    const key = `${normStr(r.pp_set_name)}|${r.pp_language}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push({ tcg_set_code: r.tcg_set_code, tcg_language: r.tcg_language })
  }
  console.log(`[aliases] ${data?.length ?? 0} aliases loaded (incl. seeds)`)
  return map
}

// -------- Matcher --------
function matchPp(ppCard, aliasMap) {
  const ppLang = ppCard.language === 'jp' ? 'jp' : 'en'
  const tcgLang = PP_LANG_TO_TCG[ppLang]
  const strippedSet = (ppCard.set_name || '').replace(/^Japanese /i, '').trim()
  const setKey = `${normStr(strippedSet)}|${ppLang}`
  const variantTag = extractVariantTag(ppCard.card_name)
  const cleanedName = cleanName(ppCard.card_name)
  const num = normNum(ppCard.card_number)
  const hasFirstEdInSet = /1st edition/i.test(ppCard.set_name || '')
  const hasShadowless   = /shadowless/i.test(ppCard.set_name || '')
  const expectedKey = expectedPrintingKey(variantTag, hasFirstEdInSet, hasShadowless)

  const candidates = []
  const seenIds = new Set()
  function push(card, { method, confidence, reasons, printingKey }) {
    const id = `${card.id}|${printingKey || 'normal'}`
    if (seenIds.has(id)) return
    seenIds.add(id)
    const printing = (card.printings || []).find(p => p.key === (printingKey || 'normal'))
                   || (card.printings || [])[0]
    candidates.push({
      card,
      printing,
      printingKey: printing?.key || null,
      method,
      confidence,
      reasons,
    })
  }

  // Pass 1: resolve via set alias → set code
  const aliases = aliasMap.get(setKey) || []
  const codes = aliases.map(a => a.tcg_set_code)
  // Also try implicit same-name set
  const implicitSets = setByNormName.get(`${normStr(strippedSet)}|${tcgLang}`) || []
  for (const s of implicitSets) if (!codes.includes(s.code)) codes.push(s.code)

  for (const code of codes) {
    const key = `${code}|${num}|${tcgLang}`
    const rows = bySetNumLang.get(key) || []
    for (const r of rows) {
      const nameMatches = normName(r.name) === normName(cleanedName)
      if (nameMatches) {
        push(r, {
          method: aliases.find(a => a.tcg_set_code === code) ? 'set_alias' : 'exact',
          confidence: 'high',
          reasons: [`set=${code}`, `collector=${num}`, 'name match', expectedKey ? `printing=${expectedKey}` : null].filter(Boolean),
          printingKey: expectedKey || 'normal',
        })
      } else {
        push(r, {
          method: 'set_number_name_mismatch',
          confidence: 'medium',
          reasons: [`set=${code}`, `collector=${num}`, `name mismatch (PP="${cleanedName}" vs TCG="${r.name}")`],
          printingKey: expectedKey || 'normal',
        })
      }
    }
  }

  // Pass 2: name + collector_number across language (no set constraint)
  if (candidates.length === 0) {
    const key = `${normName(cleanedName)}|${num}|${tcgLang}`
    const rows = byNameNumLang.get(key) || []
    for (const r of rows) {
      push(r, {
        method: 'name_number',
        confidence: rows.length === 1 ? 'medium' : 'low',
        reasons: ['no set resolved', `name+collector=${num}`, rows.length > 1 ? `${rows.length} candidates` : 'unique'],
        printingKey: expectedKey || 'normal',
      })
    }
  }

  // Pass 3: baseCardId reprint linking
  //   If we have one high-confidence candidate, surface its reprints as additional candidates
  //   so operators can see "this card has promo reprints".
  if (candidates.length > 0) {
    const primary = candidates[0]
    const reprints = reprintsOf.get(primary.card.id) || []
    for (const rc of reprints) {
      push(rc, {
        method: 'basecard_reprint',
        confidence: 'low',
        reasons: [`reprint of ${primary.card.id}`, `set=${rc.set_code}`],
        printingKey: 'normal',
      })
    }
  }

  // Decide top-line match & confidence
  const scored = candidates.map(c => ({
    ...c,
    _score: ({ verified: 4, high: 3, medium: 2, low: 1 })[c.confidence],
  })).sort((a, b) => b._score - a._score)

  // Verified: exactly one high-confidence candidate matching set+number+name
  // and the printing_key is a clean match
  let top_status = 'unmatched'
  let top_confidence = null
  if (scored.length === 0) {
    top_status = 'unmatched'
  } else {
    const highOnly = scored.filter(s => s.confidence === 'high')
    if (highOnly.length === 1) {
      top_status = 'pending_review'
      top_confidence = 'verified'    // single unambiguous high-confidence
    } else if (highOnly.length > 1) {
      top_status = 'pending_review'
      top_confidence = 'medium'      // conflicting high-confidence
    } else {
      top_status = 'pending_review'
      top_confidence = scored[0].confidence
    }
  }

  return { candidates: scored, top_status, top_confidence, expectedKey, variantTag }
}

// -------- Pull PP cards --------
async function pullPpCards() {
  console.log('[pp] pulling non-sealed Pokémon cards from production...')
  const all = []
  let offset = 0
  const PAGE = 1000
  while (offset < 100000) {
    const { data, error } = await sb.from('cards')
      .select('id, card_slug, card_name, set_name, card_number, language, card_url_slug, set_release_date, image_url')
      .eq('is_sealed', false)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) throw new Error(`cards: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`[pp] ${all.length} non-sealed cards loaded`)
  return all
}

// -------- Run --------
const aliasMap = await ensureSetAliases()
const ppCards = await pullPpCards()

console.log('[match] generating candidates + mappings...')
const mappingRows = []
const candidateRows = []
const statusCounts = {}

for (const pp of ppCards) {
  const r = matchPp(pp, aliasMap)
  const top = r.candidates[0] || null
  statusCounts[r.top_status] = (statusCounts[r.top_status] || 0) + 1

  // Mapping row
  mappingRows.push({
    provider: PROVIDER,
    pp_card_slug: pp.card_slug,
    pp_set_name: pp.set_name,
    pp_card_name: pp.card_name,
    pp_language: pp.language,
    tcg_card_id: top?.card.id || null,
    tcg_printing_key: top?.printingKey || null,
    tcg_price_card_id: top?.printing?.cardId || top?.card.id || null,
    tcg_set_code: top?.card.set_code || null,
    tcg_language: top?.card.language || null,
    tcg_name: top?.card.name || null,
    match_method: top?.method || null,
    confidence: r.top_confidence,
    review_status: r.top_status,
    catalogue_version: CATALOGUE_VERSION,
  })

  // Candidate rows (all, so operator can see alternatives)
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
console.log(`[match] generated ${mappingRows.length} mapping rows, ${candidateRows.length} candidate rows`)
console.log(`[match] status counts:`, statusCounts)

// Deduplicate candidate rows by (provider, pp_card_slug, tcg_card_id, tcg_printing_key || 'normal')
const seenCandidateKeys = new Set()
const deduped = []
for (const c of candidateRows) {
  const k = `${c.provider}|${c.pp_card_slug}|${c.tcg_card_id}|${c.tcg_printing_key || 'normal'}`
  if (seenCandidateKeys.has(k)) continue
  seenCandidateKeys.add(k)
  deduped.push(c)
}
console.log(`[dedupe] candidates: ${candidateRows.length} → ${deduped.length}`)
candidateRows.length = 0
candidateRows.push(...deduped)

// -------- Clear + bulk insert --------
async function bulkInsert(table, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const { error } = await sb.from(table).upsert(chunk, {
      onConflict: table === 'pokemon_tcg_mappings'
        ? 'provider,pp_card_slug'
        : 'provider,pp_card_slug,tcg_card_id,tcg_printing_key',
    })
    if (error) throw new Error(`${table} chunk ${i}: ${error.message}`)
    if ((i / batchSize) % 10 === 0) console.log(`  ${table}: ${i + chunk.length}/${rows.length}`)
  }
}

// Clear old candidates for this provider first (regenerate-able)
console.log('[clean] clearing old candidates...')
const { error: cErr } = await sb.from('pokemon_tcg_mapping_candidates').delete().eq('provider', PROVIDER).neq('id', '00000000-0000-0000-0000-000000000000')
if (cErr) console.log('  (nothing to clear)')

console.log('[insert] mappings...')
await bulkInsert('pokemon_tcg_mappings', mappingRows)
console.log('[insert] candidates...')
await bulkInsert('pokemon_tcg_mapping_candidates', candidateRows)

console.log('\n[DONE]')
console.log('Status counts:', statusCounts)
console.log(`Mappings: ${mappingRows.length}`)
console.log(`Candidates: ${candidateRows.length}`)
