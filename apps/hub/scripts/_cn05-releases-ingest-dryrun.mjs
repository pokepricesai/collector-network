// CN-05 Release Tracker — read-only probe of the ingester against production.
//
// Fetches Scryfall /sets + ygoprodeck /cardsets, computes WHAT WOULD BE
// upserted, but writes NOTHING. This is a safety net before the first
// cron run so I can confirm the predicate filters are sensible.
//
// Writes nothing to Supabase. Only reads existing network_tcg_releases
// rows for a lookup diff. Use the live cron (/api/cron/releases-ingest)
// for the actual populate.

import '../../../scripts/_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const UA = 'CollectorNetwork/0.1 (contact: lukejosephpierce@gmail.com)'
const todayIso = new Date().toISOString().slice(0, 10)

async function existingByTcg(tcg) {
  const { data, error } = await sb.from('network_tcg_releases')
    .select('id, set_code, release_date, verification_mode')
    .eq('tcg', tcg)
    .eq('language', 'en')
  if (error) throw error
  const map = new Map()
  for (const r of data ?? []) map.set(r.set_code, r)
  return map
}

async function probeScryfall() {
  const res = await fetch('https://api.scryfall.com/sets', { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`scryfall HTTP ${res.status}`)
  const payload = await res.json()
  const KEEP = new Set(['expansion', 'core', 'commander', 'masterpiece', 'starter', 'draft_innovation'])
  const SKIP = new Set(['token', 'promo', 'memorabilia', 'alchemy', 'planechase', 'archenemy', 'vanguard', 'funny', 'treasure_chest', 'arsenal', 'spellbook'])
  const existing = await existingByTcg('mtg')
  const toInsert = [], toUpdate = [], toDateChange = []
  for (const s of payload.data ?? []) {
    if (!s.released_at || s.released_at < todayIso) continue
    if (SKIP.has(s.set_type)) continue
    if (!KEEP.has(s.set_type) && s.set_type !== 'expansion') continue
    const code = s.code.toUpperCase()
    const prev = existing.get(code)
    if (!prev) { toInsert.push({ code, name: s.name, type: s.set_type, released_at: s.released_at }); continue }
    if (prev.verification_mode === 'manual') continue
    if (prev.release_date !== s.released_at) {
      toDateChange.push({ code, name: s.name, prev: prev.release_date, next: s.released_at })
      toUpdate.push({ code, name: s.name, released_at: s.released_at })
    } else {
      toUpdate.push({ code, name: s.name, released_at: s.released_at })
    }
  }
  return { toInsert, toUpdate, toDateChange }
}

async function probeYgoProDeck() {
  const res = await fetch('https://db.ygoprodeck.com/api/v7/cardsets.php', { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`ygoprodeck HTTP ${res.status}`)
  const sets = await res.json()
  const existing = await existingByTcg('ygo')
  const toInsert = [], toUpdate = [], toDateChange = []
  for (const s of sets) {
    if (!s.tcg_date || s.tcg_date < todayIso) continue
    if (!s.set_code) continue
    const code = s.set_code
    const prev = existing.get(code)
    if (!prev) { toInsert.push({ code, name: s.set_name, tcg_date: s.tcg_date }); continue }
    if (prev.verification_mode === 'manual') continue
    if (prev.release_date !== s.tcg_date) {
      toDateChange.push({ code, name: s.set_name, prev: prev.release_date, next: s.tcg_date })
      toUpdate.push({ code, name: s.set_name, tcg_date: s.tcg_date })
    } else {
      toUpdate.push({ code, name: s.set_name, tcg_date: s.tcg_date })
    }
  }
  return { toInsert, toUpdate, toDateChange }
}

console.log('=== Scryfall MTG probe ===')
const scryfall = await probeScryfall()
console.log(`would insert: ${scryfall.toInsert.length}`)
for (const r of scryfall.toInsert.slice(0, 20)) console.log(`  + ${r.code}  ${r.released_at}  (${r.type})  ${r.name}`)
console.log(`would update (no date change): ${scryfall.toUpdate.length - scryfall.toDateChange.length}`)
console.log(`date changes: ${scryfall.toDateChange.length}`)
for (const d of scryfall.toDateChange) console.log(`  * ${d.code}  ${d.prev} → ${d.next}  ${d.name}`)

console.log('')
console.log('=== ygoprodeck YGO probe ===')
const ygo = await probeYgoProDeck()
console.log(`would insert: ${ygo.toInsert.length}`)
for (const r of ygo.toInsert.slice(0, 20)) console.log(`  + ${r.code}  ${r.tcg_date}  ${r.name}`)
console.log(`would update (no date change): ${ygo.toUpdate.length - ygo.toDateChange.length}`)
console.log(`date changes: ${ygo.toDateChange.length}`)
for (const d of ygo.toDateChange) console.log(`  * ${d.code}  ${d.prev} → ${d.next}  ${d.name}`)
