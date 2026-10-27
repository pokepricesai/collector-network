#!/usr/bin/env node
// scripts/_cn05-pp-ygo-backfill-probe.mjs
//
// CN-05 Sprint 6 — read-only feasibility probe for PokePrices + YGO
// exact-product coverage via existing authorised data sources.
//
// Investigates:
//   1. pokemon_tcg_mappings → tcg_printings join yield (PokePrices).
//   2. YGO tcg_printings rows with any TCGplayer identifier shape
//      we might have overlooked (tcgplayer_id, cardmarket_id, or
//      tcggraph source URLs embedded in metadata JSON).
//   3. Sample rows for manual QA.
//
// No mutations. Six HEAD-only counts + 2 small SELECTs.

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

async function count(builder) {
  const { count: c, error } = await builder
  if (error) throw error
  return c ?? 0
}

async function main() {
  console.log('')
  console.log('CN-05 Sprint 6 — PokePrices + YGO backfill feasibility')
  console.log('=====================================================')

  // ---------- PokePrices via pokemon_tcg_mappings ----------
  console.log('\n[PokePrices] pokemon_tcg_mappings status counts:')
  for (const status of ['approved', 'pending_review', 'unmatched', 'rejected', 'no_tcg_equivalent']) {
    const n = await count(
      sb.from('pokemon_tcg_mappings').select('id', { count: 'exact', head: true }).eq('review_status', status),
    )
    console.log(`  ${status.padEnd(28)} ${n}`)
  }
  const approvedWithTcg = await count(
    sb
      .from('pokemon_tcg_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('review_status', 'approved')
      .not('tcg_card_id', 'is', null),
  )
  console.log(`  approved AND tcg_card_id non-null: ${approvedWithTcg}`)

  // Sample 3 approved rows + confirm the join yields a tcgplayer_id.
  console.log('\n[PokePrices] 3 sample approved rows with tcg_printings join:')
  const { data: samples, error: sErr } = await sb
    .from('pokemon_tcg_mappings')
    .select('pp_card_slug, pp_card_name, tcg_card_id, tcg_printing_key, tcg_language, confidence')
    .eq('review_status', 'approved')
    .not('tcg_card_id', 'is', null)
    .limit(3)
  if (sErr) throw sErr
  for (const s of samples ?? []) {
    const { data: tcgRows, error: pErr } = await sb
      .from('tcg_printings')
      .select('id, tcgplayer_id, mapping_confidence, finish, language')
      .eq('tcggraph_card_id', s.tcg_card_id)
      .limit(5)
    if (pErr) {
      console.log(`  slug=${s.pp_card_slug} join_error=${pErr.message}`)
      continue
    }
    const exact = (tcgRows ?? []).find((r) => r.tcgplayer_id != null && r.mapping_confidence === 'exact')
    console.log(
      `  slug=${s.pp_card_slug.padEnd(25)} ` +
        `tcg_card_id=${s.tcg_card_id?.slice(0, 24)} ` +
        `rows=${tcgRows?.length ?? 0} ` +
        `exact_tcgplayer_id=${exact?.tcgplayer_id ?? '—'}`,
    )
  }

  // ---------- YGO deeper inspection ----------
  console.log('\n[YGO] tcg_printings for yugioh:')
  const totalYgo = await count(
    sb.from('tcg_printings').select('id', { count: 'exact', head: true }).eq('game_id', 'yugioh'),
  )
  const withTcg = await count(
    sb
      .from('tcg_printings')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', 'yugioh')
      .not('tcgplayer_id', 'is', null),
  )
  const withCardmarket = await count(
    sb
      .from('tcg_printings')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', 'yugioh')
      .not('cardmarket_id', 'is', null),
  )
  console.log(`  total                : ${totalYgo}`)
  console.log(`  with tcgplayer_id    : ${withTcg}`)
  console.log(`  with cardmarket_id   : ${withCardmarket}`)

  // Sample 3 YGO printings to see what IDs they do carry.
  console.log('\n[YGO] 3 sample tcg_printings rows:')
  const { data: ygoSamples, error: ySErr } = await sb
    .from('tcg_printings')
    .select('id, tcggraph_card_id, tcggraph_printing_key, finish, tcgplayer_id, cardmarket_id, mapping_confidence')
    .eq('game_id', 'yugioh')
    .limit(3)
  if (ySErr) throw ySErr
  for (const r of ygoSamples ?? []) {
    console.log(
      `  id=${r.id?.slice(0, 48).padEnd(50)} ` +
        `tcgplayer=${r.tcgplayer_id ?? '—'} ` +
        `cardmarket=${r.cardmarket_id ?? '—'} ` +
        `conf=${r.mapping_confidence}`,
    )
  }

  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
