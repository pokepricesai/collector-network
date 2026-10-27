#!/usr/bin/env node
// scripts/_cn05/tcgplayer-coverage-probe.mjs
//
// CN-05 Sprint 5 — one-off read-only diagnostic. Reports per-game:
//   total_printings | with_tcgplayer_id | pct
// Does NOT mutate anything. Uses the shared Supabase service-role
// client via scripts/_lib/load-env.mjs; no new credentials.
//
// Why `count: 'exact', head: true`: PostgREST returns a Content-Range
// header with the exact count without transferring row data, so this
// stays well under 2 KB on the wire per query.

import '../_lib/load-env.mjs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(2)
}

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

async function listGames() {
  const { data, error } = await sb
    .from('tcg_games')
    .select('id, slug, name, active')
    .order('slug')
  if (error) throw error
  return data ?? []
}

async function totalPrintings(gameId) {
  const { count, error } = await sb
    .from('tcg_printings')
    .select('tcg_printing_id:id', { count: 'exact', head: true })
    .eq('game_id', gameId)
  if (error) throw error
  return count ?? 0
}

async function withTcgplayerId(gameId) {
  const { count, error } = await sb
    .from('tcg_printings')
    .select('tcg_printing_id:id', { count: 'exact', head: true })
    .eq('game_id', gameId)
    .not('tcgplayer_id', 'is', null)
  if (error) throw error
  return count ?? 0
}

async function main() {
  const games = await listGames()
  console.log('')
  console.log('CN-05 Sprint 5 — TCGplayer product_id coverage')
  console.log('==============================================')
  console.log('')
  console.log(
    'game'.padEnd(16) +
      'total'.padStart(10) +
      'with_id'.padStart(12) +
      'pct'.padStart(10),
  )
  console.log('-'.repeat(48))

  for (const g of games) {
    if (!g.active) continue
    const [total, matched] = await Promise.all([
      totalPrintings(g.id),
      withTcgplayerId(g.id),
    ])
    const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '—'
    console.log(
      g.slug.padEnd(16) +
        String(total).padStart(10) +
        String(matched).padStart(12) +
        (pct === '—' ? pct : `${pct}%`).padStart(10),
    )
  }
  console.log('')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
