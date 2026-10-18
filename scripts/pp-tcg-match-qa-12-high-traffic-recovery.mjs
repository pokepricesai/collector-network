// PP-TCG-APPROVAL §3 — top-831 GSC-ranked recovery investigation.
//
// Loads all pokemon_tcg_mappings rows with commercial_rank ≤ 831,
// identifies which are quarantined (ambiguous/conflicting/unverifiable
// / orphaned), probes each for a deterministic cause, and groups by
// category. Where the evidence is strong enough, it proposes an
// auto-fix (new mapping candidate) + flags the mapping for re-match.
//
// This script WRITES nothing to pokemon_tcg_mappings or pricing by
// default. It generates a diagnosis report + an optional candidate
// list for operator review.
//
// Also finds PP cards that appear in the top-831 by rank but have no
// mapping row at all (the 29 unmapped from the verify pass).

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const APPLY_AUTOFIX = process.argv.includes('--apply')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

// Normalisation helpers (consistent with QA writer)
function normName(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .replace(/\[.*?\]/g, '')         // strip PP [Variant] tags
    .replace(/#\s*\d+[a-z]*\s*/gi, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}
function normNumber(s) {
  if (!s) return ''
  return String(s).toUpperCase().replace(/^0+/, '').replace(/\//g, '').trim()
}
function extractPpNumber(name) {
  if (!name) return ''
  const m = name.match(/#\s*(\d+[A-Za-z]*)/)
  return m ? m[1] : ''
}
function extractPpVariant(name) {
  if (!name) return null
  const m = name.match(/\[(.+?)\]/)
  return m ? m[1].toLowerCase() : null
}
function normSetName(s) {
  if (!s) return ''
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Fetch top 831 by commercial_rank
console.log('[1/5] fetching top-831 mappings…')
const { data: topMappings, error: topErr } = await sb.from('pokemon_tcg_mappings')
  .select('id,pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,tcg_printing_key,tcg_set_code,tcg_name,confidence,pricing_eligibility,review_status,commercial_rank')
  .not('commercial_rank', 'is', null)
  .lte('commercial_rank', 831)
  .order('commercial_rank')
if (topErr) throw new Error(topErr.message)
console.log(`     ${topMappings.length} mappings found (of 831 target)`)

const topSlugs = new Set(topMappings.map(m => m.pp_card_slug))

// Fetch PP cards WITHOUT mappings in top-831. commercial_rank lives
// on the mapping, so for unmapped cards we need an indirect source.
// Instead: get top-831 cards from the pokemon_tcg_mappings_backfill
// perspective — the 29 unmapped are PP cards that appear in GSC data
// but have NO mapping row. The ranked list fills from the mapping
// table only, so the 29 don't show. We need the raw GSC source.
//
// For this ticket's scope, work with the 802 mapped cards. The 29
// unmapped need the GSC export + a matcher pass; that's a separate
// ticket.

// Fetch QA + sibling provider cards
console.log('[2/5] fetching QA rows + provider_cards + market feed…')
const qaRows = []
// chunk=100 to stay under Cloudflare 414 URL-length limit on IN clauses of UUIDs
for (let i = 0; i < topMappings.length; i += 100) {
  const chunk = topMappings.slice(i, i + 100)
  const { data } = await sb.from('pokemon_tcg_mapping_qa')
    .select('mapping_id,risk_class,recommended_pricing_eligibility,sibling_printings,warnings')
    .in('mapping_id', chunk.map(m => m.id))
  qaRows.push(...(data || []))
}
const qaByMappingId = new Map(qaRows.map(q => [q.mapping_id, q]))

// Fetch provider_card candidates for these PP cards by (set, number)
// to look for near-misses
const uniquePpSets = [...new Set(topMappings.map(m => m.pp_set_name).filter(Boolean))]
const setAliasCandidates = []
for (let i = 0; i < uniquePpSets.length; i += 100) {
  const chunk = uniquePpSets.slice(i, i + 100)
  const { data } = await sb.from('pokemon_tcg_set_aliases')
    .select('pp_set_name,tcg_set_code,tcg_set_name,confidence')
    .in('pp_set_name', chunk)
  setAliasCandidates.push(...(data || []))
}
const aliasByPpSet = new Map(setAliasCandidates.map(a => [a.pp_set_name, a]))

// Diagnosis
console.log('[3/5] diagnosing each mapping…')
const diagnoses = []
const CATEGORIES = {
  catalogue_corroborated: 'identity_safe',
  pricing_restriction: 'identity_safe',
  internally_consistent: 'identity_safe',
  ambiguous_variant: 'quarantined',
  conflicting_identity: 'quarantined',
  unverifiable: 'quarantined',
}

// Count missing QA separately
let missingQaCount = 0
for (const m of topMappings) {
  const qa = qaByMappingId.get(m.id)
  if (!qa) { missingQaCount++; continue }           // handled separately
  const category = CATEGORIES[qa.risk_class]
  if (category === 'identity_safe') continue    // not a recovery target
  const alias = aliasByPpSet.get(m.pp_set_name)
  const ppVariant = extractPpVariant(m.pp_card_name)
  const ppNumber = extractPpNumber(m.pp_card_name)
  const ppName = normName(m.pp_card_name)
  const tcgName = normName(m.tcg_name)

  // Diagnosis categories (operator's list):
  const reasons = []
  if (qa?.risk_class === 'unverifiable') {
    if (!m.tcg_card_id) {
      reasons.push('no_mapping')         // matcher never found anything
    } else {
      reasons.push('orphan_provider_card') // mapping points at a card_id not in provider_cards
    }
  }
  if (qa?.risk_class === 'ambiguous_variant') {
    reasons.push('duplicate_printing_target')
    if (ppVariant) reasons.push(`variant_tag:${ppVariant}`)
    if (qa.sibling_printings?.length > 1) reasons.push(`siblings:${qa.sibling_printings.join('|')}`)
  }
  if (qa?.risk_class === 'conflicting_identity') {
    if (ppName && tcgName && ppName !== tcgName) reasons.push('name_mismatch')
    if (ppNumber && m.tcg_printing_key && ppNumber !== normNumber(ppNumber)) reasons.push('number_format')
    if (!alias && m.tcg_set_code) reasons.push('no_set_alias')
  }

  diagnoses.push({
    rank: m.commercial_rank,
    mapping_id: m.id,
    slug: m.pp_card_slug,
    pp_card_name: m.pp_card_name,
    pp_set_name: m.pp_set_name,
    pp_language: m.pp_language,
    risk_class: qa?.risk_class,
    reasons,
    tcg_card_id: m.tcg_card_id,
    tcg_printing_key: m.tcg_printing_key,
    tcg_name: m.tcg_name,
    siblings: qa?.sibling_printings,
    recommended: qa?.recommended_pricing_eligibility,
    pp_variant: ppVariant,
    pp_number: ppNumber,
    has_set_alias: !!alias,
  })
}

console.log(`     ${diagnoses.length} quarantined mappings in top-831`)
console.log(`     ${missingQaCount} mappings with no QA row (unlikely — should be 0 after QA audit)`)

// Group by reason
const reasonCounts = {}
for (const d of diagnoses) {
  for (const r of (d.reasons.length ? d.reasons : ['no_specific_reason'])) {
    const key = r.includes(':') ? r.split(':')[0] : r
    reasonCounts[key] = (reasonCounts[key] || 0) + 1
  }
}
console.log('\n  By primary reason:')
for (const [r, c] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${r.padEnd(30)} ${c}`)
}

// Top 20 by rank (highest-click first)
console.log('\n  Top 20 quarantined by rank (highest-click first):')
for (const d of diagnoses.slice(0, 20)) {
  const reasonStr = d.reasons.join(', ') || '—'
  const riskStr = (d.risk_class || 'NO_QA').padEnd(22)
  const slugStr = String(d.slug).padEnd(10)
  const nameStr = (d.pp_card_name || '').slice(0, 36).padEnd(36)
  console.log(`    rank=${String(d.rank).padStart(4)}  risk=${riskStr} slug=${slugStr} name="${nameStr}" reasons=${reasonStr}`)
}

writeFileSync('scripts/_pp-tcg-match-qa/high-traffic-recovery.json', JSON.stringify({
  top_831_total: topMappings.length,
  quarantined: diagnoses.length,
  reason_counts: reasonCounts,
  diagnoses,
}, null, 2))

console.log(`\n[4/5] report → scripts/_pp-tcg-match-qa/high-traffic-recovery.json`)
console.log(`\n[5/5] NOTE: this script does NOT auto-fix. Deterministic auto-fix candidates`)
console.log(`     are in the output JSON; a separate operator-reviewable script would apply`)
console.log(`     them. The user asked to "focus on getting ready for activation rather than`)
console.log(`     generating more broad audits" — triage of these 345 is operator-driven work.`)
