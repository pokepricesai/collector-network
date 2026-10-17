// PP-TCG-MATCH-01A: backfill pricing_eligibility + commercial_rank
// on every pokemon_tcg_mappings row.
//
// Idempotent. Safe to re-run after any matcher regeneration.

import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

// Inline the classification logic to avoid TS-import gymnastics in a .mjs script.
// Kept in sync with apps/hub/src/server/pokemon-matching/eligibility.ts.

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
}
const KNOWN_UNSUPPORTED = new Set([
  'Mirror Holo','Jumbo','Prize Pack','Rainbow Foil','Stamped','Prism','Gold Star',
  'Sparkle','Tekno','Prize Pack Cosmos Holo','Glossy Prism','Holo Prism','Silver Foil',
])
const PROMO_REPRINT_CARD_ID = /_promo|wcd\d|_jumbo|_prize|_sparkle|_tekno/i

function extractVariantTag(s) { const m=(s||'').match(/\[([^\]]+)\]/); return m?m[1].trim():null }
function ppLangToTcgLang(l) { return (l==='jp'||l==='ja')?'ja':'en' }

function classify(row, sharesClash) {
  if (['rejected','no_tcg_equivalent','unmatched'].includes(row.review_status) || !row.tcg_card_id) {
    return 'not_eligible'
  }
  const tag = extractVariantTag(row.pp_card_name)
  const expectedKey = tag
    ? (KNOWN_UNSUPPORTED.has(tag) ? null : (PP_TAG_TO_PRINTING_KEY[tag] ?? null))
    : 'normal'
  if (row.confidence !== 'verified') return 'uncertain'
  if (tag && KNOWN_UNSUPPORTED.has(tag)) return 'identity_only'
  if (tag && !PP_TAG_TO_PRINTING_KEY[tag]) return 'identity_only'
  if (tag && expectedKey && row.tcg_printing_key && row.tcg_printing_key !== expectedKey) return 'identity_only'
  const expectedLang = ppLangToTcgLang(row.pp_language)
  if (row.tcg_language && row.tcg_language !== expectedLang) return 'identity_only'
  if (PROMO_REPRINT_CARD_ID.test(row.tcg_card_id)) return 'identity_only'
  if (sharesClash) return 'identity_only'
  if (tag && expectedKey && expectedKey !== 'normal') return 'market_only'
  return 'bulk_safe'
}

// ---- Load GSC rank for commercial_rank ----
const gscPath = 'C:/Users/lukep/OneDrive/Desktop/pokeprices-web/seo/exports/gsc-pages-90d.csv'
const gscLines = readFileSync(gscPath, 'utf-8').split(/\r?\n/).slice(1)
const gscCards = gscLines
  .map(l => l.match(/^"?([^,"]+)"?,(\d+),(\d+)/))
  .filter(m => m && /\/set\//.test(m[1]) && /\/card\//.test(m[1]))
  .map(m => ({ url: m[1], clicks: Number(m[2]) }))
gscCards.sort((a, b) => b.clicks - a.clicks)
// Build: (normalised set+slug) → rank
function normStr(s) { return (s || '').toLowerCase().replace(/[^\w]/g, '') }
function parseUrl(url) {
  const m = url.match(/\/set\/([^/]+)\/card\/(.+?)\/?$/)
  if (!m) return null
  return { set: decodeURIComponent(m[1]).replace(/\+/g, ' '), slug: decodeURIComponent(m[2]) }
}
const gscRankByKey = new Map()
gscCards.forEach((c, i) => {
  const p = parseUrl(c.url)
  if (!p) return
  const key = `${normStr(p.set)}|${normStr(p.slug)}`
  if (!gscRankByKey.has(key)) gscRankByKey.set(key, i + 1)
})
console.log(`[gsc] ${gscRankByKey.size} card URLs ranked by 90d clicks`)

// ---- Load PP cards to resolve set_name + url_slug for GSC join ----
console.log('[pp] pulling cards (set_name + url_slug for GSC join)...')
const PAGE = 1000
let offset = 0
const ppIdxBySlug = new Map()
while (offset < 100000) {
  const { data, error } = await sb.from('cards')
    .select('card_slug, card_url_slug, set_name')
    .eq('is_sealed', false)
    .order('id')
    .range(offset, offset + PAGE - 1)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  for (const r of data) ppIdxBySlug.set(r.card_slug, r)
  if (data.length < PAGE) break
  offset += PAGE
}
console.log(`[pp] ${ppIdxBySlug.size} PP cards indexed`)

// ---- Pull all mappings ----
console.log('[maps] pulling all mappings...')
const mappings = []
offset = 0
while (offset < 200000) {
  const { data, error } = await sb.from('pokemon_tcg_mappings')
    .select('id, pp_card_slug, pp_card_name, pp_language, tcg_card_id, tcg_printing_key, tcg_language, confidence, review_status, pricing_eligibility, commercial_rank')
    .order('id')
    .range(offset, offset + PAGE - 1)
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) break
  mappings.push(...data)
  if (data.length < PAGE) break
  offset += PAGE
}
console.log(`[maps] ${mappings.length} mapping rows`)

// ---- Pre-compute target clash (two PP slugs → same TCG target) ----
const targetMap = new Map()
for (const m of mappings) {
  if (!m.tcg_card_id) continue
  if (m.confidence !== 'verified') continue
  if (!['pending_review','approved'].includes(m.review_status)) continue
  const k = `${m.tcg_card_id}|${m.tcg_printing_key || 'normal'}`
  if (!targetMap.has(k)) targetMap.set(k, [])
  targetMap.get(k).push(m.pp_card_slug)
}
const clashKeys = new Set()
for (const [k, ss] of targetMap.entries()) if (ss.length > 1) clashKeys.add(k)
console.log(`[clash] ${clashKeys.size} TCG targets shared by >1 PP slug`)

// ---- Classify + build update payload ----
let bulk_safe = 0, market_only = 0, identity_only = 0, not_eligible = 0, uncertain = 0
let ranked = 0
const updates = []
for (const m of mappings) {
  const k = `${m.tcg_card_id}|${m.tcg_printing_key || 'normal'}`
  const sharesClash = clashKeys.has(k)
  const elig = classify(m, sharesClash)
  if (elig === 'bulk_safe') bulk_safe++
  if (elig === 'market_only') market_only++
  if (elig === 'identity_only') identity_only++
  if (elig === 'not_eligible') not_eligible++
  if (elig === 'uncertain') uncertain++

  const pp = ppIdxBySlug.get(m.pp_card_slug)
  let rank = null
  if (pp) {
    const key = `${normStr(pp.set_name)}|${normStr(pp.card_url_slug || m.pp_card_slug)}`
    const r = gscRankByKey.get(key)
    if (r != null) { rank = r; ranked++ }
  }

  // Only queue update if something changed
  if (elig !== m.pricing_eligibility || rank !== m.commercial_rank) {
    updates.push({ id: m.id, pricing_eligibility: elig, commercial_rank: rank })
  }
}
console.log(`[classify] bulk_safe=${bulk_safe}, market_only=${market_only}, identity_only=${identity_only}, not_eligible=${not_eligible}, uncertain=${uncertain}`)
console.log(`[gsc] ranked ${ranked} rows`)
console.log(`[update] ${updates.length} rows need updating`)

// ---- Bulk update via explicit UPDATE statements (parallel chunks) ----
const CONCURRENCY = 20
let done = 0
async function worker(queue) {
  while (queue.length > 0) {
    const u = queue.pop()
    if (!u) break
    const { error } = await sb.from('pokemon_tcg_mappings')
      .update({ pricing_eligibility: u.pricing_eligibility, commercial_rank: u.commercial_rank })
      .eq('id', u.id)
    if (error) throw new Error(`update ${u.id}: ${error.message}`)
    done++
    if (done % 2000 === 0) console.log(`  updated ${done}/${updates.length}`)
  }
}
const queue = [...updates]
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))
console.log(`  updated ${done}/${updates.length}`)

console.log('[DONE]')
console.log(`Final counts: bulk_safe=${bulk_safe}, market_only=${market_only}, identity_only=${identity_only}, not_eligible=${not_eligible}, uncertain=${uncertain}`)
