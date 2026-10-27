#!/usr/bin/env node
// scripts/_cn05-ygo-tcgplayer-probe.mjs
//
// CN-05 Sprint 7 Task 3 — YGO exact-product investigation.
//
// Sprint 6 Task 3 bug: queried tcg_printings WHERE game_id='yugioh'
// got 0 rows. The game_id is NOT the literal slug — it's whatever
// tcg_games.id stores. Look it up first, then sample.
//
// Also checks whether any upstream source (raw tcggraph_meta on
// tcg_sets, or any adjacent table) carries TCGplayer references for
// yugioh printings that could be backfilled into tcg_printings.tcgplayer_id.

import '../../../scripts/_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) { console.error('Missing env'); process.exit(2) }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

function containsTcgplayer(node) {
  if (node == null) return false
  if (typeof node === 'string') return /tcgplayer\.com\/product\/\d+/i.test(node) || /tcgplayerId/i.test(node)
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      if (/tcg[\s_-]?player/i.test(k)) return true
      if (containsTcgplayer(node[k])) return true
    }
  }
  return false
}

async function main() {
  console.log('\nCN-05 Sprint 7 Task 3 — YGO TCGplayer upstream investigation')
  console.log('===========================================================')

  // 1. Correct game_id lookup.
  console.log('\n[1] tcg_games row for yugioh (by slug):')
  const { data: games, error: gErr } = await sb
    .from('tcg_games')
    .select('id, slug, name, active')
    .eq('slug', 'yugioh')
  if (gErr) { console.error(gErr); process.exit(1) }
  for (const g of games ?? []) {
    console.log(`  id="${g.id}" slug="${g.slug}" name="${g.name}" active=${g.active}`)
  }
  const ygoId = games?.[0]?.id
  if (!ygoId) { console.log('  NO ROW FOUND for slug=yugioh'); process.exit(0) }

  // 2. Totals + populated-field counts for the correct game_id.
  const totalQ = sb.from('tcg_printings').select('id', { count: 'exact', head: true }).eq('game_id', ygoId)
  const withTcgQ = sb.from('tcg_printings').select('id', { count: 'exact', head: true }).eq('game_id', ygoId).not('tcgplayer_id', 'is', null)
  const withCmQ = sb.from('tcg_printings').select('id', { count: 'exact', head: true }).eq('game_id', ygoId).not('cardmarket_id', 'is', null)
  const [t, wtcg, wcm] = await Promise.all([totalQ, withTcgQ, withCmQ])
  console.log('\n[2] tcg_printings counts for yugioh:')
  console.log(`  total                 : ${t.count ?? 0}`)
  console.log(`  with tcgplayer_id     : ${wtcg.count ?? 0}`)
  console.log(`  with cardmarket_id    : ${wcm.count ?? 0}`)

  // 3. Sample 5 rows + the matching set to see what IDs they carry.
  const { data: samples, error: sErr } = await sb
    .from('tcg_printings')
    .select('id, tcggraph_card_id, tcggraph_printing_key, finish, tcgplayer_id, cardmarket_id, mapping_confidence, set_id')
    .eq('game_id', ygoId)
    .limit(5)
  if (sErr) { console.error(sErr); process.exit(1) }
  console.log('\n[3] 5 sample YGO tcg_printings rows:')
  for (const r of samples ?? []) {
    console.log(
      `  tcggraph_card_id=${(r.tcggraph_card_id ?? '-').slice(0, 24).padEnd(24)} ` +
        `key=${(r.tcggraph_printing_key ?? '-').padEnd(14)} ` +
        `finish=${(r.finish ?? '-').padEnd(10)} ` +
        `tcgplayer=${r.tcgplayer_id ?? '—'} ` +
        `cardmarket=${r.cardmarket_id ?? '—'} ` +
        `conf=${r.mapping_confidence}`,
    )
  }

  // 4. For those sample sets, inspect tcggraph_meta for TCGplayer evidence.
  const setIds = [...new Set((samples ?? []).map((r) => r.set_id).filter(Boolean))]
  if (setIds.length > 0) {
    const { data: sets } = await sb
      .from('tcg_sets')
      .select('id, code, name, tcggraph_meta')
      .in('id', setIds)
    console.log('\n[4] tcg_sets.tcggraph_meta on sampled sets — any TCGplayer refs?')
    for (const s of sets ?? []) {
      const hit = containsTcgplayer(s.tcggraph_meta)
      console.log(`  set=${(s.code ?? '-').padEnd(10)} name="${(s.name ?? '-').slice(0, 40)}" tcgplayer_in_meta=${hit}`)
    }
  }

  // 5. Does the shared tcg_external_ids table carry YGO TCGplayer IDs?
  const { count: ygoExtTcg } = await sb
    .from('tcg_external_ids')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', ygoId)
    .eq('provider', 'tcgplayer')
  console.log('\n[5] tcg_external_ids provider=tcgplayer for YGO:')
  console.log(`  count: ${ygoExtTcg ?? 0}`)

  console.log('')
}

main().catch((e) => { console.error(e); process.exit(1) })
