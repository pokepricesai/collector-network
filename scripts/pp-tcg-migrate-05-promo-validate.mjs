// PP-TCG-MIGRATE-05 §3: validate each of the 12 promo-set proposals
// against TCGGraph's own set metadata + the mapped PP cards.
//
// Rules:
//   1. The TCG set must be a REAL distinct set with a release date
//      OR at least 10 cards. (Merchandise categories like Burger
//      King Promos get flagged if release date is missing + card
//      count low — operator can override.)
//   2. ≥2 verified PP mappings must point at the TCG set.
//   3. Membership must be reconciled: every PP mapping has a
//      specific tcg_set_code that matches the proposal.
//   4. No duplicate memberships (same tcg_card_id in two proposed
//      promo sets simultaneously).
//
// Updates pokemon_tcg_promo_set_proposals.review_state based on
// these checks. Operator can still override to 'approved' manually
// via the admin UI.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-05', { recursive: true })

const sets = JSON.parse(readFileSync('scripts/_pp-data-test-02/outputs/sets.json', 'utf-8'))
const setByCode = new Map(sets.map(s => [s.code, s]))

const { data: proposals, error } = await sb.from('pokemon_tcg_promo_set_proposals')
  .select('*').order('pp_rows_mapped', { ascending: false })
if (error) throw new Error(error.message)
console.log(`[input] ${proposals.length} proposals`)

const findings = []
for (const p of proposals) {
  const tcgSet = setByCode.get(p.tcg_set_code)
  const reasons = []
  let verdict = 'approved'    // start optimistic
  if (!tcgSet) {
    verdict = 'rejected'
    reasons.push('tcg_set_code not found in TCGGraph /v1/sets')
  } else {
    if (!tcgSet.releasedAt && (tcgSet.cards ?? 0) < 10) {
      verdict = 'needs_more_data'
      reasons.push(`merchandise-style: no release date + <10 cards (releasedAt=${tcgSet.releasedAt}, cards=${tcgSet.cards})`)
    }
  }

  // Verify PP mapping membership
  const { data: members } = await sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, tcg_card_id, tcg_set_code, pp_language, confidence, pricing_eligibility')
    .eq('tcg_set_code', p.tcg_set_code)
    .eq('confidence', 'verified')
  const memberCount = members?.length ?? 0
  if (memberCount < 2) {
    verdict = 'rejected'
    reasons.push(`only ${memberCount} verified PP mappings`)
  }

  findings.push({
    tcg_set_code: p.tcg_set_code,
    tcg_set_name: p.tcg_set_name,
    tcg_language: p.tcg_language,
    tcg_release: tcgSet?.releasedAt ?? null,
    tcg_cards: tcgSet?.cards ?? null,
    pp_rows_mapped: p.pp_rows_mapped,
    pp_members: memberCount,
    verdict,
    reasons,
    sample_members: (members || []).slice(0, 5).map(m => ({ slug: m.pp_card_slug, lang: m.pp_language, elig: m.pricing_eligibility })),
  })

  // Persist the recommendation; operator can still override
  await sb.from('pokemon_tcg_promo_set_proposals')
    .update({
      review_state: verdict,
      notes: reasons.length > 0 ? reasons.join(' · ') : 'auto-approved by validator',
    })
    .eq('tcg_set_code', p.tcg_set_code)
}

// Duplicate-membership check: does any tcg_card_id appear in >1 proposal?
const { data: allMembers } = await sb.from('pokemon_tcg_mappings')
  .select('tcg_card_id, tcg_set_code')
  .eq('confidence', 'verified')
  .in('tcg_set_code', proposals.map(p => p.tcg_set_code))
const bySetCard = new Map()
for (const r of allMembers || []) {
  if (!bySetCard.has(r.tcg_card_id)) bySetCard.set(r.tcg_card_id, new Set())
  bySetCard.get(r.tcg_card_id).add(r.tcg_set_code)
}
const dupeMembers = [...bySetCard.entries()].filter(([_, s]) => s.size > 1)
if (dupeMembers.length) console.log(`[DUPES] ${dupeMembers.length} TCG card_ids appear in >1 proposed promo set`)
else console.log(`[DUPES] 0 — clean membership`)

writeFileSync('scripts/_pp-tcg-migrate-05/promo-validation.json', JSON.stringify({
  findings, duplicate_members: dupeMembers.length,
}, null, 2))

console.log('\n=== VALIDATION ===')
for (const f of findings) {
  console.log(`${f.verdict.toUpperCase().padEnd(16)} ${f.tcg_set_code.padEnd(10)} ${f.tcg_set_name} (${f.tcg_language}, released ${f.tcg_release}, ${f.pp_members} members)`)
  for (const r of f.reasons) console.log(`   • ${r}`)
}

console.log('\n[done] see scripts/_pp-tcg-migrate-05/promo-validation.json')
