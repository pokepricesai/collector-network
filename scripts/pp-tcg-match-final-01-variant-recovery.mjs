// PP-TCG-MATCH-FINAL §2 — variant-tag mismatch recovery.
//
// Pattern: two PP mappings share the SAME (tcg_card_id, tcg_printing_key)
// with QA risk_class='ambiguous_variant'. One PP card has a [Variant] tag,
// the other doesn't. The tagged one should remap to the matching variant
// printing_key (if TCGGraph publishes that printing for the same card_id).
//
// Only acts when:
//   • TCG actually has the expected printing_key as an ACTIVE row for the
//     same card_id (zero speculative mappings)
//   • Exactly one PP card in the pair has the variant tag (unambiguous)
//
// Updates: rewrites the tagged mapping's `tcg_printing_key` to the matching
// variant key. Demotes `review_status` to 'pending_review'. QA is re-run
// post-apply using the existing writer logic. Writes audit row.
//
// Dry-run by default. --apply to execute.

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-final', { recursive: true })

async function fetchAll(table, select, filter = q => q, order = 'id') {
  const out = []; let from = 0
  while (true) {
    const { data, error } = await filter(sb.from(table).select(select).order(order)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

// Variant tag → preferred printing_key(s). Order matters — try first match.
const VARIANT_MAP = {
  '1st edition':        ['1st-edition-foil', '1st-edition'],   // prefer -foil if available (holo rares etc.)
  'reverse holo':       ['reverse-holo'],
  'cosmos holo':        ['cosmos-holo'],
  'shadowless':         ['shadowless'],
  'poke ball':          ['pokeball'],
  'pokeball':           ['pokeball'],
  'master ball':        ['masterball'],
  'masterball':         ['masterball'],
  'quick ball':         ['quickball'],
  'quickball':          ['quickball'],
  'love ball':          ['loveball'],
  'loveball':           ['loveball'],
  'dusk ball':          ['duskball'],
  'duskball':           ['duskball'],
  'friend ball':        ['friendball'],
  'friendball':         ['friendball'],
  'cracked ice':        ['cracked-ice'],
  'cracked ice holo':   ['cracked-ice'],
  'pokemon center':     ['pokemon-center'],
  'prize pack':         ['prize-pack'],
  'staff':              ['staff'],
  'prerelease staff':   ['staff', 'prerelease'],
  'prerelease':         ['prerelease'],
  'league':             ['league'],
  'league promo':       ['league'],
  'pokemon league':     ['league'],
  'team rocket':        ['team-rocket'],
  // Known-no-match (TCG does not ship these as distinct printings for the card_id):
  //   'mirror holo', 'holo', 'jumbo', 'stamped', '1999-2000', 'snowflake stamp',
  //   'play', 'box topper', 'professor program' — handled as 'no safe recovery'
}

function hasVariantTag(name) { return /\[.+?\]/.test(name || '') }
function getVariantTag(name) {
  const m = (name || '').match(/\[(.+?)\]/)
  return m ? m[1].toLowerCase().trim() : null
}

// 1. Pull ambiguous_variant QA + mappings
console.log('[1/4] fetching ambiguous_variant mappings…')
const ambig = await fetchAll('pokemon_tcg_mapping_qa', 'mapping_id,tcg_card_id,tcg_printing_key', q => q.eq('risk_class', 'ambiguous_variant'))
console.log(`     ${ambig.length} ambiguous_variant rows`)

const mapIds = ambig.map(a => a.mapping_id)
const maps = []
for (let i = 0; i < mapIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_mappings').select('id,pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,tcg_printing_key,tcg_set_code,tcg_language,review_status,pricing_eligibility,confidence').in('id', mapIds.slice(i, i + 100))
  maps.push(...(data || []))
}
const mapById = new Map(maps.map(m => [m.id, m]))

// 2. Build target-sharing groups
const byTarget = new Map()
for (const a of ambig) {
  const k = a.tcg_card_id + '|' + a.tcg_printing_key
  if (!byTarget.has(k)) byTarget.set(k, [])
  byTarget.get(k).push(mapById.get(a.mapping_id))
}

// 3. For each target group with the tagged/plain pattern, plan the move
console.log('[2/4] scanning for recoverable pairs…')
const noMatch = { byTag: {} }

// Gather candidate card_ids first
const candidateCardIds = new Set()
for (const [k, cards] of byTarget) {
  const taggedCards = cards.filter(c => c && hasVariantTag(c.pp_card_name))
  if (taggedCards.length === 0) continue
  for (const t of taggedCards) candidateCardIds.add(t.tcg_card_id)
}

console.log(`[3/4] verifying candidate printings exist active in provider_cards…`)
const activePrintings = new Map()
const cardIds = [...candidateCardIds]
for (let i = 0; i < cardIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key')
    .eq('provider_status', 'active')
    .in('tcg_card_id', cardIds.slice(i, i + 100))
  for (const r of (data || [])) {
    if (!activePrintings.has(r.tcg_card_id)) activePrintings.set(r.tcg_card_id, new Set())
    activePrintings.get(r.tcg_card_id).add(r.tcg_printing_key)
  }
}

const recovered = []
const noActivePrinting = { byTag: {} }
const noDefault = { byTag: {} }
for (const [k, cards] of byTarget) {
  const taggedCards = cards.filter(c => c && hasVariantTag(c.pp_card_name))
  const plainCards = cards.filter(c => c && !hasVariantTag(c.pp_card_name))
  if (taggedCards.length === 0) continue
  // Handle one tagged at a time
  for (const tagged of taggedCards) {
    const tag = getVariantTag(tagged.pp_card_name)
    const candidates = VARIANT_MAP[tag] || null
    if (!candidates) { noMatch.byTag[tag] = (noMatch.byTag[tag] || 0) + 1; continue }
    const active = activePrintings.get(tagged.tcg_card_id) || new Set()
    let chosen = null
    for (const c of candidates) if (active.has(c)) { chosen = c; break }
    if (!chosen) { noActivePrinting.byTag[tag] = (noActivePrinting.byTag[tag] || 0) + 1; continue }

    // Case A: TAGGED is at the wrong key → MOVE TAGGED to variant key
    if (tagged.tcg_printing_key !== chosen) {
      recovered.push({
        mapping_id: tagged.id,
        pp_card_slug: tagged.pp_card_slug,
        pp_card_name: tagged.pp_card_name,
        tag,
        tcg_card_id: tagged.tcg_card_id,
        from_printing: tagged.tcg_printing_key,
        to_printing: chosen,
        prior_review_status: tagged.review_status,
        prior_pricing_eligibility: tagged.pricing_eligibility,
        move_target: 'tagged',
      })
      continue
    }

    // Case B: TAGGED is already at the right key → MOVE PLAIN(s) to a default key
    // Default preference: normal > foil (keep the plain card at the base printing)
    const defaults = ['normal', 'foil']
    let defKey = null
    for (const d of defaults) if (active.has(d) && d !== chosen) { defKey = d; break }
    if (!defKey) { noDefault.byTag[tag] = (noDefault.byTag[tag] || 0) + 1; continue }
    for (const plain of plainCards) {
      recovered.push({
        mapping_id: plain.id,
        pp_card_slug: plain.pp_card_slug,
        pp_card_name: plain.pp_card_name,
        tag: '(plain-moved-because-tagged-correct)',
        tcg_card_id: plain.tcg_card_id,
        from_printing: plain.tcg_printing_key,
        to_printing: defKey,
        prior_review_status: plain.review_status,
        prior_pricing_eligibility: plain.pricing_eligibility,
        move_target: 'plain',
        hint: `tagged ${tagged.pp_card_name} is correctly at ${chosen}; moving plain to ${defKey}`,
      })
    }
  }
}

console.log(`     tags with no TCG alias (skipped):`)
for (const [t, n] of Object.entries(noMatch.byTag).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`       ${t.padEnd(28)} ${n}`)
console.log(`     tags with alias but no active printing on card_id:`)
for (const [t, n] of Object.entries(noActivePrinting.byTag).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`       ${t.padEnd(28)} ${n}`)
console.log(`     tags where plain has no default-key fallback:`)
for (const [t, n] of Object.entries(noDefault.byTag).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`       ${t.padEnd(28)} ${n}`)

console.log(`     RECOVERABLE: ${recovered.length}`)
console.log(`     tags with alias but no active printing on the card_id:`)
for (const [t, n] of Object.entries(noActivePrinting.byTag).sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`       ${t.padEnd(28)} ${n}`)

// Group by (from → to) for operator visibility
const byMove = {}
for (const r of recovered) {
  const k = `${r.from_printing} → ${r.to_printing}  (tag=${r.tag})`
  byMove[k] = (byMove[k] || 0) + 1
}
console.log('\n[4/4] recovery plan by move direction:')
for (const [k, n] of Object.entries(byMove).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`     ${k.padEnd(50)} ${n}`)

writeFileSync('scripts/_pp-tcg-match-final/variant-recovery.json', JSON.stringify({ recovered, noMatch, noActivePrinting, byMove }, null, 2))

if (!APPLY) {
  console.log('\n[dry-run] no writes. Re-run with --apply to execute.')
  process.exit(0)
}

// APPLY
console.log('\n[apply] writing updates…')
const runId = `variant-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}`
let applied = 0
for (let i = 0; i < recovered.length; i += 50) {
  const chunk = recovered.slice(i, i + 50)
  for (const r of chunk) {
    // Update mapping — change printing_key, demote status so operator reviews post-QA
    const prev = r.prior_review_status
    const { error: uErr } = await sb.from('pokemon_tcg_mappings').update({
      tcg_printing_key: r.to_printing,
      review_status: 'pending_review',
      previous_review_status: prev,
      match_method: 'variant_tag_mismatch_recovery',
      updated_at: new Date().toISOString(),
    }).eq('id', r.mapping_id)
    if (uErr) throw new Error(`mapping ${r.mapping_id}: ${uErr.message}`)
    // Audit
    await sb.from('pokemon_tcg_mapping_audit').insert({
      mapping_id: r.mapping_id,
      pp_card_slug: r.pp_card_slug,
      provider: 'tcggraph',
      action: 'variant_tag_mismatch_recovery',
      from_status: prev,
      to_status: 'pending_review',
      from_printing_key: r.from_printing,
      to_printing_key: r.to_printing,
      reason: `tag='${r.tag}' resolved to printing_key='${r.to_printing}' (active in provider_cards)`,
      actor_display: 'automation:pp-tcg-match-final-01',
      metadata: { run_id: runId, variant_tag: r.tag, prior_pricing_eligibility: r.prior_pricing_eligibility },
    })
    applied += 1
  }
  if (i % 500 === 0) console.log(`     applied ${applied}…`)
}
console.log(`\n[done] run_id=${runId}  applied=${applied}/${recovered.length}`)
console.log('       Re-run QA on these mapping_ids to assign new risk_class + recommended_eligibility.')
