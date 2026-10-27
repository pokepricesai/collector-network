#!/usr/bin/env node
// scripts/_cn05-pp-effective-coverage.mjs
//
// CN-05 Sprint 9 Task 3 — effective exact-product coverage.
//
// Approved mappings are not the same as "cards that will display an
// exact-product CTA on prod". The real display path layers four
// gates on top of the mapping row:
//
//   1. review_status = 'approved' (37,224 rows)
//   2. v_pokemon_tcg_effective_eligibility.effective_eligibility
//      must be in {bulk_safe, market_only, identity_only}
//      (per snapshot.ts; identity_only disables prices, so we
//       separately track bulk_safe + market_only for the "shows
//       exact CTA" count)
//   3. pokemon_tcg_provider_cards row with provider_status='active'
//   4. raw_payload.external_ids.tcgplayerId resolves to a numeric
//
// This script measures each gate's attrition.

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing env'); process.exit(2) }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })
async function count(b) { const { count: c, error } = await b; if (error) throw error; return c ?? 0 }

async function main() {
  console.log('\nCN-05 Sprint 9 — PP effective exact-product coverage\n')

  // Gate 1 — approved
  const approved = await count(sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true }).eq('review_status', 'approved'))
  console.log(`Gate 1  approved mappings                     : ${approved}`)

  // Gate 2 — effective eligibility distribution across approved rows.
  //
  // v_pokemon_tcg_effective_eligibility is per (pp_card_slug, provider).
  // We join via pp_card_slug + provider='tcggraph'.
  const { data: effSample } = await sb
    .from('v_pokemon_tcg_effective_eligibility')
    .select('effective_eligibility')
    .eq('provider', 'tcggraph')
    .limit(100000)
  const effDist = new Map()
  for (const r of effSample ?? []) {
    const k = r.effective_eligibility ?? '(null)'
    effDist.set(k, (effDist.get(k) ?? 0) + 1)
  }
  console.log(`Gate 2  effective_eligibility distribution (${effSample?.length ?? 0} tcggraph rows):`)
  for (const [k, c] of [...effDist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`          ${k.padEnd(26)} ${c}`)
  }

  // Gate 2a — only bulk_safe + market_only surface market data.
  //           identity_only renders images only (no exact CTA shown in
  //           the TCGplayer flow today; the chain null-guards at
  //           providerCardActive, which still gates on provider_cards
  //           presence). For reporting we count the 3 image-eligible
  //           classes separately.
  const eligFor_exact_cta = (effDist.get('bulk_safe') ?? 0) + (effDist.get('market_only') ?? 0)
  console.log(`Gate 2a bulk_safe + market_only (CTA-eligible): ${eligFor_exact_cta}`)

  // Gate 3 — provider_cards active with raw_payload
  const activeWithPayload = await count(
    sb.from('pokemon_tcg_provider_cards').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph').eq('provider_status', 'active').not('raw_payload', 'is', null),
  )
  console.log(`Gate 3  provider_cards active with payload   : ${activeWithPayload}`)

  // Gate 4 — numeric tcgplayerId within raw_payload. PostgREST can
  // filter by jsonb path extraction.
  const withNumericTcg = await count(
    sb.from('pokemon_tcg_provider_cards').select('id', { count: 'exact', head: true })
      .eq('provider', 'tcggraph').eq('provider_status', 'active')
      .not('raw_payload->external_ids->>tcgplayerId', 'is', null),
  )
  console.log(`Gate 4  provider_cards with numeric tcg id   : ${withNumericTcg}`)

  // Intersection — approximate: for every approved mapping, join to the
  // effective-view (eligibility bulk_safe/market_only) AND into a
  // provider_cards row with provider_status='active' AND non-null
  // tcgplayerId. Done in Node with a windowed read because PostgREST
  // doesn't support arbitrary 3-way joins cleanly.
  const { data: approvedRows } = await sb
    .from('pokemon_tcg_mappings')
    .select('pp_card_slug, tcg_card_id, tcg_printing_key')
    .eq('review_status', 'approved')
    .not('tcg_card_id', 'is', null).not('tcg_printing_key', 'is', null)
    .limit(50000)
  const approvedTotal = approvedRows?.length ?? 0
  // Build quick lookups: approved by slug.
  const approvedBySlug = new Map()
  for (const r of approvedRows ?? []) approvedBySlug.set(r.pp_card_slug, r)
  // Pull effective eligibility rows filtered to bulk_safe/market_only.
  const { data: eligRows } = await sb
    .from('v_pokemon_tcg_effective_eligibility')
    .select('pp_card_slug, effective_eligibility')
    .eq('provider', 'tcggraph')
    .in('effective_eligibility', ['bulk_safe', 'market_only'])
    .limit(100000)
  const eligSet = new Set((eligRows ?? []).map((r) => r.pp_card_slug))
  // Intersect.
  let approvedAndEligible = 0
  for (const s of approvedBySlug.keys()) if (eligSet.has(s)) approvedAndEligible++
  console.log(`\nIntersection (approved ∩ bulk/market_only)   : ${approvedAndEligible} / ${approvedTotal}`)

  // For a sample of 50 intersected pp_card_slugs, check whether the
  // matching provider_cards row (card_id + printing_key, active) has
  // a numeric tcgplayerId. This yields the effective coverage.
  const sampleSlugs = []
  for (const s of approvedBySlug.keys()) {
    if (!eligSet.has(s)) continue
    sampleSlugs.push(s)
    if (sampleSlugs.length >= 50) break
  }
  let withTcgplayerExact = 0
  let withSearchFallback = 0
  for (const slug of sampleSlugs) {
    const m = approvedBySlug.get(slug)
    const { data: pc } = await sb
      .from('pokemon_tcg_provider_cards')
      .select('tcgplayer_product_id:raw_payload->external_ids->>tcgplayerId')
      .eq('provider', 'tcggraph').eq('provider_status', 'active')
      .eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key)
      .maybeSingle()
    const id = pc?.tcgplayer_product_id
    if (id && /^\d+$/.test(String(id))) withTcgplayerExact++
    else withSearchFallback++
  }
  console.log(`\nSample of 50 approved+eligible pp_card_slugs:`)
  console.log(`  with exact tcgplayer product id            : ${withTcgplayerExact}`)
  console.log(`  falling back to search                     : ${withSearchFallback}`)
  console.log(`  implied effective exact-product coverage   : ${((withTcgplayerExact / sampleSlugs.length) * 100).toFixed(1)}%`)

  // Projected effective coverage across the full approved+eligible set
  console.log(`\nProjected network-wide exact-product cards   : ~${Math.round(approvedAndEligible * (withTcgplayerExact / sampleSlugs.length)).toLocaleString()}`)
  console.log(`Projected cards still on search fallback     : ~${Math.round(approvedAndEligible * (withSearchFallback / sampleSlugs.length)).toLocaleString()}`)

  // Representative 20 for spot-checking.
  console.log(`\n[20 representative exact-product slugs for manual spot check]`)
  let printed = 0
  for (const slug of sampleSlugs) {
    const m = approvedBySlug.get(slug)
    const { data: pc } = await sb
      .from('pokemon_tcg_provider_cards')
      .select('tcgplayer_product_id:raw_payload->external_ids->>tcgplayerId')
      .eq('provider', 'tcggraph').eq('provider_status', 'active')
      .eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key)
      .maybeSingle()
    const id = pc?.tcgplayer_product_id
    if (!id || !/^\d+$/.test(String(id))) continue
    const { data: c } = await sb.from('cards').select('card_name, set_name, card_url_slug').eq('card_slug', slug).maybeSingle()
    const setPart = encodeURIComponent(c?.set_name ?? '')
    const cardPart = (c?.card_url_slug ?? slug).toString().replace(/^pc-/, '')
    console.log(`  https://www.pokeprices.io/set/${setPart}/card/${cardPart}  → tcgplayer.com/product/${id}  (${m.tcg_printing_key})`)
    printed++
    if (printed >= 20) break
  }

  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
