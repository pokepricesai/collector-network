// PP-TCG-MIGRATE-06 §2+§3: proper promo-set classification.
//
// Rule: a TCG set is a PROMO SET only if its NAME explicitly says
// "Promo"/"Promotional"/"Black Star"/"Prerelease"/"League &
// Championship Cards"/"Professor Program" OR its CODE ends in a
// known promo-tier suffix (`p`, `-p`, `promo`). The simple regex
// "contains 'League'" matches "Dream League" (an expansion subset)
// and must be ruled out.
//
// Also fills in gaps: existing proposals come from the ≥2-member
// threshold applied to the SMALLER set of promos the earlier
// matcher routed to. There may be TCG promo sets with 1 PP mapping
// (operator can still want them) or TCG promo sets that didn't
// receive any mappings (potential future match work).

import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-06', { recursive: true })

const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))

// Classification rules — explicit, operator-reviewable.
function classifyTcgSet(set) {
  const name = set.name || ''
  const code = set.code || ''

  // Positive promo signals in the NAME
  const promoNameSignals = [
    /\bblack star promos?\b/i,
    /\bpromotional cards?\b/i,
    /\bpromo card pack\b/i,
    /\bpromo collection\b/i,
    /\bchampionship.*promos?\b/i,
    /\bworld championships?\b/i,
    /\bprerelease promos?\b/i,
    /\bprofessor program promos?\b/i,
    /\bpikachu world collection\b/i,
    /\bleague.*championship cards?\b/i,
    /\bchampionship series promos?\b/i,
    /\bkids wb promos?\b/i,
    /\bburger king promos?\b/i,
    /\bmcdonalds? promos?\b/i,
  ]

  // Negative signals (looks promo-y via a word but is a standard expansion)
  const falsePositives = [
    /\bdream league\b/i,     // SM11b expansion subset
    /\bexpansion\b/i,
    /\bbase set\b/i,
    /\bgym heroes\b/i,
    /\bchallenge from the darkness\b/i,
  ]

  // Suspicious — merchandise categories (not Pokémon TCG proper)
  const merchandise = [
    /\btopps\b/i, /\bburger king\b/i, /\bmcdonalds?\b/i, /\bbest buy\b/i,
    /\bpopcorn\b/i, /\bcereal\b/i,
  ]

  for (const re of falsePositives) if (re.test(name)) return { kind: 'standard_subset', confidence: 'high', why: `name matches '${re}'` }
  for (const re of merchandise) if (re.test(name)) return { kind: 'merchandise', confidence: 'high', why: `name matches '${re}'` }
  for (const re of promoNameSignals) if (re.test(name)) return { kind: 'promo', confidence: 'high', why: `name matches '${re}'` }

  // Fallback by code — codes ending in 'p' or '-p' are generally
  // Japanese per-era promo sets (DP-P, ADV-P, PCG-P), tracked by
  // g-codes with 'promotional' in the name too.
  if (/^[a-z]+p$/i.test(code) && /promotional|promo/i.test(name)) {
    return { kind: 'promo', confidence: 'medium', why: 'code ends in p + name says promotional' }
  }
  if (/^wcd\d{4}$/i.test(code)) {
    return { kind: 'promo', confidence: 'high', why: 'World Championship Decks code pattern' }
  }

  return { kind: 'unknown', confidence: 'low', why: 'no classifier rule matched' }
}

// Pull proposals
const { data: proposals } = await sb.from('pokemon_tcg_promo_set_proposals')
  .select('*').order('pp_rows_mapped', { ascending: false })

console.log('=== Reclassification of existing proposals ===')
const toUpdate = []
for (const p of proposals) {
  const tcgSet = sets.find(s => s.code === p.tcg_set_code)
  if (!tcgSet) {
    console.log(`  ${p.tcg_set_code.padEnd(10)} NOT FOUND in sets`)
    toUpdate.push({ tcg_set_code: p.tcg_set_code, review_state: 'rejected', notes: 'TCG set not found in catalogue' })
    continue
  }
  const c = classifyTcgSet(tcgSet)
  const newState =
    c.kind === 'promo' ? (p.pp_rows_mapped >= 2 ? 'approved' : 'needs_more_data') :
    c.kind === 'standard_subset' ? 'rejected' :
    c.kind === 'merchandise' ? 'rejected' :
    'needs_more_data'
  console.log(`  ${p.tcg_set_code.padEnd(10)} ${(tcgSet.name || '').padEnd(45)} kind=${c.kind.padEnd(16)} → state=${newState}  (${c.why})`)
  toUpdate.push({ tcg_set_code: p.tcg_set_code, review_state: newState, notes: `${c.kind} (${c.confidence}): ${c.why}` })
}

for (const u of toUpdate) {
  await sb.from('pokemon_tcg_promo_set_proposals')
    .update({ review_state: u.review_state, notes: u.notes })
    .eq('tcg_set_code', u.tcg_set_code)
}

// Now expand: find TCG promo sets we DIDN'T propose but have PP mappings
console.log('\n=== Scanning for missed promo sets ===')
const promoSetCodes = new Set()
for (const s of sets) {
  const c = classifyTcgSet(s)
  if (c.kind === 'promo' && c.confidence !== 'low') promoSetCodes.add(s.code)
}
console.log(`[found] ${promoSetCodes.size} TCG sets classified as promo`)

const existing = new Set(proposals.map(p => p.tcg_set_code))
const missed = [...promoSetCodes].filter(c => !existing.has(c))
console.log(`[missed] ${missed.length} promo sets NOT currently in proposals table`)

// How many PP mappings do these have?
const BATCH = 200
const additions = []
for (let i = 0; i < missed.length; i += BATCH) {
  const chunk = missed.slice(i, i + BATCH)
  const { data: mappings } = await sb.from('pokemon_tcg_mappings')
    .select('tcg_set_code, pp_card_slug')
    .in('tcg_set_code', chunk)
    .eq('confidence', 'verified')
  const counts = {}
  for (const m of (mappings || [])) counts[m.tcg_set_code] = (counts[m.tcg_set_code] || 0) + 1
  for (const code of chunk) {
    const tcgSet = sets.find(s => s.code === code)
    if (!tcgSet) continue
    const n = counts[code] || 0
    const c = classifyTcgSet(tcgSet)
    additions.push({
      tcg_set_code: code,
      tcg_set_name: tcgSet.name,
      tcg_language: tcgSet.language,
      pp_rows_mapped: n,
      proposed_public_slug: (tcgSet.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      review_state: n >= 2 ? 'approved' : (n === 1 ? 'needs_more_data' : 'proposed'),
      notes: `${c.kind} (${c.confidence}): ${c.why} · ${n} PP mappings`,
    })
  }
}
additions.sort((a, b) => b.pp_rows_mapped - a.pp_rows_mapped)
console.log(`[add] ${additions.length} new proposals (any member count)`)
console.log(`  with ≥2 PP members: ${additions.filter(a => a.pp_rows_mapped >= 2).length}`)
console.log(`  with 1 PP member:   ${additions.filter(a => a.pp_rows_mapped === 1).length}`)
console.log(`  with 0 PP members:  ${additions.filter(a => a.pp_rows_mapped === 0).length}`)

const { error } = await sb.from('pokemon_tcg_promo_set_proposals').upsert(additions, { onConflict: 'tcg_set_code' })
if (error) throw new Error(`upsert: ${error.message}`)

console.log('\n=== Top new proposals (≥2 members) ===')
for (const a of additions.filter(a => a.pp_rows_mapped >= 2).slice(0, 15)) {
  console.log(`  ${a.tcg_set_code.padEnd(10)} ${a.tcg_set_name.padEnd(45)} lang=${a.tcg_language} rows=${a.pp_rows_mapped} state=${a.review_state}`)
}

writeFileSync('scripts/_pp-tcg-migrate-06/promo-reclassify.json', JSON.stringify({
  reclassified: toUpdate, newly_proposed: additions,
}, null, 2))

console.log('\n[done]')
