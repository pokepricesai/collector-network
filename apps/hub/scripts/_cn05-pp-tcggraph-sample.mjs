#!/usr/bin/env node
// scripts/_cn05-pp-tcggraph-sample.mjs
//
// CN-05 Sprint 7 Task 2 — Pokémon exact-product feasibility probe.
//
// Samples 50 approved pokemon_tcg_mappings rows across varied sets.
// For each, joins to pokemon_tcg_provider_cards.raw_payload and
// looks for TCGplayer product-ID / URL evidence inside the TCGGraph
// response blob. Classifies each sample as:
//
//   EXACT   — raw_payload contains a numeric TCGplayer product ID
//             we could emit as an exact deep link.
//   URL     — raw_payload contains a TCGplayer product URL (we can
//             parse an ID out of /product/{N}).
//   NONE    — no TCGplayer reference at all; search-URL only.
//
// Prints a summary table + 5 example raw_payload keypaths so the
// Sprint 7 report can state what shape the data takes.

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing env'); process.exit(2) }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

// Deeply walk a jsonb value and collect any TCGplayer product-ID / URL
// hits. Returns { productIds: Set<number>, urls: Set<string>, paths: Set<string> }.
function collectTcgplayerEvidence(root) {
  const productIds = new Set()
  const urls = new Set()
  const paths = new Set()
  function walk(node, path) {
    if (node == null) return
    if (typeof node === 'string') {
      // Match 'tcgplayer.com/product/{digits}' and extract.
      const m = node.match(/tcgplayer\.com\/product\/(\d+)/)
      if (m) { productIds.add(Number(m[1])); urls.add(node); paths.add(path) }
      return
    }
    if (typeof node === 'number' || typeof node === 'boolean') return
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`)
      return
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const keyLower = k.toLowerCase()
        // Also catch "productId"/"tcgplayer_id"/"tcg_player_id" numeric fields
        // whose name signals TCGplayer identity even without a URL.
        if (/tcg[\s_-]?player/i.test(keyLower) && (typeof v === 'number' || /^\d+$/.test(String(v)))) {
          productIds.add(Number(v))
          paths.add(`${path}.${k}`)
        }
        walk(v, `${path}.${k}`)
      }
    }
  }
  walk(root, '$')
  return { productIds, urls, paths }
}

async function main() {
  console.log('\nCN-05 Sprint 7 — Pokémon TCGplayer product-ID feasibility')
  console.log('=========================================================')

  // Sample 50 approved mappings, trying to vary set codes.
  const { data: mappings, error: mErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('pp_card_slug, pp_card_name, pp_set_name, tcg_card_id, tcg_printing_key, tcg_set_code')
    .eq('review_status', 'approved')
    .not('tcg_card_id', 'is', null)
    .limit(50)
  if (mErr) { console.error(mErr); process.exit(1) }

  console.log(`\nSampling ${mappings?.length ?? 0} approved mappings...\n`)

  const results = []
  const examplePaths = new Set()
  for (const m of mappings ?? []) {
    const { data: pc, error: pErr } = await sb
      .from('pokemon_tcg_provider_cards')
      .select('raw_payload, provider_status')
      .eq('provider', 'tcggraph')
      .eq('tcg_card_id', m.tcg_card_id)
      .eq('tcg_printing_key', m.tcg_printing_key)
      .maybeSingle()
    if (pErr) continue
    const evidence = pc?.raw_payload
      ? collectTcgplayerEvidence(pc.raw_payload)
      : { productIds: new Set(), urls: new Set(), paths: new Set() }
    const cls = evidence.productIds.size > 0 ? 'EXACT' : 'NONE'
    for (const p of evidence.paths) {
      if (examplePaths.size < 8) examplePaths.add(p)
    }
    results.push({
      slug: m.pp_card_slug,
      name: m.pp_card_name,
      set: m.tcg_set_code,
      cls,
      productId: evidence.productIds.size > 0 ? [...evidence.productIds][0] : null,
      hasPayload: !!pc?.raw_payload,
      status: pc?.provider_status,
    })
  }

  const exact = results.filter((r) => r.cls === 'EXACT').length
  const none = results.filter((r) => r.cls === 'NONE').length
  const withPayload = results.filter((r) => r.hasPayload).length
  const total = results.length
  console.log(`Totals (of ${total} sampled, ${withPayload} with raw_payload):`)
  console.log(`  EXACT (product-id resolvable):  ${exact}  (${((exact / total) * 100).toFixed(1)}%)`)
  console.log(`  NONE  (no TCGplayer evidence):  ${none}  (${((none / total) * 100).toFixed(1)}%)`)

  console.log('\nFirst 10 samples:')
  for (const r of results.slice(0, 10)) {
    console.log(
      `  ${r.cls.padEnd(5)} set=${(r.set ?? '-').padEnd(8)} slug=${(r.slug ?? '-').toString().slice(0, 18).padEnd(18)} ` +
        `product_id=${r.productId ?? '—'} payload=${r.hasPayload ? 'yes' : 'NO'}`,
    )
  }

  console.log('\nUnique raw_payload keypaths where TCGplayer evidence was found:')
  for (const p of examplePaths) console.log(`  ${p}`)

  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
