// PP-TCG-MATCH §1 investigation — foil-risk audit.
//
// Operator-raised concern: a PP card like "Iron Treads ex #143" or
// "Penny #239" is classified bulk_safe when the matcher chose
// printing_key='foil' with no PP variant tag — but TCGGraph's
// card-level `graded_prices` are AGGREGATED across every printing on
// the base card. If that base card has multiple printings (normal +
// reverse-holo + pokemon-center + prize-pack + sparkle etc.), the
// aggregated graded value is biased by other printings' sales.
//
// This script quantifies: of the ~23,474 bulk_safe mappings, how
// many point at a TCG card that has >1 provider_cards sibling row
// (i.e. multiple printings on the same base card)? Those rows are
// NOT safe for card-level graded pricing even though their identity
// is correct.
//
// Zero TCGGraph credits spent. Supabase reads only.
//
// Output: scripts/_pp-tcg-match-qa/foil-risk.json

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

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

console.log('[1/4] fetching bulk_safe mappings…')
const bulkSafe = await fetchAll(
  'pokemon_tcg_mappings',
  'pp_card_slug,pp_card_name,pp_set_name,pp_language,tcg_card_id,tcg_printing_key,tcg_set_code,tcg_name,confidence,pricing_eligibility,review_status',
  q => q.eq('pricing_eligibility', 'bulk_safe').eq('confidence', 'verified'),
)
console.log(`     ${bulkSafe.length} bulk_safe mappings`)

const uniqueCardIds = [...new Set(bulkSafe.map(m => m.tcg_card_id).filter(Boolean))]
console.log(`     ${uniqueCardIds.length} unique TCG card IDs`)

console.log('[2/4] fetching provider_cards siblings for those TCG card IDs…')
const providerCards = []
const BATCH = 200
for (let i = 0; i < uniqueCardIds.length; i += BATCH) {
  const chunk = uniqueCardIds.slice(i, i + BATCH)
  const { data, error } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,tcg_set_code,tcg_language')
    .in('tcg_card_id', chunk)
  if (error) throw new Error(`provider_cards: ${error.message}`)
  providerCards.push(...(data || []))
  if (i % 1000 === 0) console.log(`     fetched ${providerCards.length}…`)
}
console.log(`     ${providerCards.length} provider_cards rows`)

const printingsByCard = {}
for (const pc of providerCards) {
  if (!printingsByCard[pc.tcg_card_id]) printingsByCard[pc.tcg_card_id] = []
  printingsByCard[pc.tcg_card_id].push(pc.tcg_printing_key)
}

console.log('[3/4] classifying each bulk_safe mapping by printing-count risk…')
const risks = { safe_single: [], risky_multi: [], risky_variant_siblings: [] }

const VARIANT_PRINTINGS = new Set([
  'pokemon-center', 'prize-pack', 'sparkle', 'staff', 'stamped', 'jumbo',
  'glossy', 'cosmos-holo', 'reverse-holo', 'first-edition', 'shadowless',
  'crystal', 'promo', 'tcg-online',
])

for (const m of bulkSafe) {
  const siblings = printingsByCard[m.tcg_card_id] || []
  if (siblings.length === 0) {
    // mapping references a card that no longer exists in provider_cards
    risks.risky_multi.push({ ...m, siblings: [], reason: 'orphan_no_provider_card' })
    continue
  }
  if (siblings.length === 1) {
    risks.safe_single.push({ ...m, siblings })
    continue
  }
  // >1 printing — graded aggregate contaminated
  const hasVariantSibling = siblings.some(k => k !== m.tcg_printing_key && VARIANT_PRINTINGS.has(k))
  if (hasVariantSibling) {
    risks.risky_variant_siblings.push({ ...m, siblings })
  } else {
    risks.risky_multi.push({ ...m, siblings })
  }
}

console.log('[4/4] writing report…')
const report = {
  summary: {
    bulk_safe_total: bulkSafe.length,
    safe_single_printing: risks.safe_single.length,
    risky_multi_printing: risks.risky_multi.length,
    risky_with_variant_sibling: risks.risky_variant_siblings.length,
  },
  samples: {
    iron_treads_143: bulkSafe.filter(m => /iron treads/i.test(m.pp_card_name || '') && /143/.test(m.pp_card_name || '')),
    penny_239: bulkSafe.filter(m => /\bpenny\b/i.test(m.pp_card_name || '') && /239/.test(m.pp_card_name || '')),
  },
  top_risky_examples: risks.risky_multi.slice(0, 20).map(r => ({
    pp_card_name: r.pp_card_name,
    pp_set_name: r.pp_set_name,
    chosen_printing: r.tcg_printing_key,
    siblings: r.siblings,
  })),
  top_variant_sibling_examples: risks.risky_variant_siblings.slice(0, 20).map(r => ({
    pp_card_name: r.pp_card_name,
    pp_set_name: r.pp_set_name,
    chosen_printing: r.tcg_printing_key,
    siblings: r.siblings,
  })),
}

for (const [k, cards] of Object.entries(report.samples)) {
  console.log(`\n${k}: ${cards.length} rows`)
  for (const c of cards.slice(0, 5)) {
    const s = printingsByCard[c.tcg_card_id] || []
    console.log(`  ${c.pp_card_name} · chosen=${c.tcg_printing_key} · siblings=[${s.join(',')}]`)
  }
}

console.log('\n=== Summary ===')
console.log(`  bulk_safe total: ${report.summary.bulk_safe_total}`)
console.log(`  → safe (single printing): ${report.summary.safe_single_printing} (${(report.summary.safe_single_printing / report.summary.bulk_safe_total * 100).toFixed(1)}%)`)
console.log(`  → RISKY (multi printing): ${report.summary.risky_multi_printing} (${(report.summary.risky_multi_printing / report.summary.bulk_safe_total * 100).toFixed(1)}%)`)
console.log(`  → RISKY (variant sibling): ${report.summary.risky_with_variant_sibling} (${(report.summary.risky_with_variant_sibling / report.summary.bulk_safe_total * 100).toFixed(1)}%)`)

writeFileSync('scripts/_pp-tcg-match-qa/foil-risk.json', JSON.stringify(report, null, 2))
console.log('\n[done]')
