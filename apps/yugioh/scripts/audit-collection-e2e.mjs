#!/usr/bin/env node
// YGO Collection E2E — scoped test user, insert raw + graded, RLS
// isolation, cleanup. Uses the shared network Supabase project.

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Service-role key lives in the MTG local env (same shared Supabase).
const MTG_ENV = readFileSync('C:/Users/lukep/OneDrive/Desktop/mtgprices-web/.env.local', 'utf8')
function envFrom(text, key) {
  const m = new RegExp('^' + key + '=(.*)$', 'm').exec(text)
  return m ? m[1].replace(/^"|"$/g, '') : ''
}
const SUPABASE_URL = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = envFrom(MTG_ENV, 'SUPABASE_SERVICE_ROLE_KEY')
const ANON_KEY = envFrom(MTG_ENV, 'NEXT_PUBLIC_SUPABASE_ANON_KEY')

const SERVICE = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const stamp = Date.now()
const emailA = `ygo-e2e-a-${stamp}@ygoprices-test.invalid`
const emailB = `ygo-e2e-b-${stamp}@ygoprices-test.invalid`
const password = randomUUID()
const created = []
function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1) }

async function cleanup() {
  console.log(`\nCleaning up ${created.length} test user(s)…`)
  for (const uid of created) {
    try {
      await SERVICE.from('ygo_collection_items').delete().eq('user_id', uid)
      await SERVICE.from('collection_items').delete().eq('user_id', uid)  // fallback
      await SERVICE.auth.admin.deleteUser(uid)
      console.log(`  ✓ deleted ${uid}`)
    } catch (e) { console.error(`  ! cleanup ${uid}: ${e.message}`) }
  }
}

try {
  // Discover the actual YGO collection table + a real printing to test with.
  const { data: cards } = await SERVICE.from('tcg_cards')
    .select('id, name')
    .eq('game_id', 'ygo').ilike('name', 'Blue-Eyes White Dragon').limit(1)
  if (!cards?.length) fail('no Blue-Eyes card in DB')
  const testCard = cards[0]
  const { data: prints } = await SERVICE.from('tcg_printings')
    .select('id, collector_number, set_id')
    .eq('tcg_card_id', testCard.id).limit(1)
  if (!prints?.length) fail('no printing for test card')
  const testPrinting = prints[0]
  console.log(`1/8 · Test target: ${testCard.name} card=${testCard.id} printing=${testPrinting.id}`)

  const { data: uA } = await SERVICE.auth.admin.createUser({ email: emailA, password, email_confirm: true })
  created.push(uA.user.id)
  const clientA = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientA.auth.signInWithPassword({ email: emailA, password })
  console.log(`2/8 · User A ${uA.user.id} authenticated`)

  // Try likely table name.
  const TABLE = 'ygo_collection_items'
  const { data: rawRow, error: rawErr } = await clientA.from(TABLE).insert({
    user_id: uA.user.id,
    tcg_card_id: testCard.id,
    tcg_printing_id: testPrinting.id,
    quantity: 1,
    is_graded: false,
    condition: 'near-mint',
    purchase_price: 99.99,
    purchase_currency: 'USD',
    notes: 'YGO E2E raw copy',
  }).select().single()
  if (rawErr) fail(`raw insert: ${rawErr.message}`)
  console.log(`3/8 · Inserted raw NM row ${rawRow.id}`)

  const { data: slabRow, error: slabErr } = await clientA.from(TABLE).insert({
    user_id: uA.user.id,
    tcg_card_id: testCard.id,
    tcg_printing_id: testPrinting.id,
    quantity: 1,
    is_graded: true,
    grader: 'psa',
    grade: '10',
    condition: 'near-mint',
    purchase_price: 1250,
    purchase_currency: 'USD',
    notes: 'YGO E2E PSA 10',
  }).select().single()
  if (slabErr) fail(`slab insert: ${slabErr.message}`)
  console.log(`4/8 · Inserted PSA 10 row ${slabRow.id}, grader=${slabRow.grader}`)

  const { data: readback } = await clientA.from(TABLE)
    .select('id, grader, grade, is_graded, quantity, condition, purchase_price')
    .eq('tcg_printing_id', testPrinting.id)
  if (!readback || readback.length !== 2) fail(`expected 2 rows, got ${readback?.length}`)
  const raw = readback.find((r) => !r.is_graded)
  const slab = readback.find((r) => r.is_graded && r.grader === 'psa' && r.grade === '10')
  if (!raw || !slab) fail('raw + PSA 10 do not coexist')
  console.log('5/8 · Raw + PSA 10 coexist for same printing')

  const { error: updErr } = await clientA.from(TABLE)
    .update({ quantity: 3 }).eq('id', rawRow.id)
  if (updErr) fail(`edit qty: ${updErr.message}`)
  const { data: reread } = await clientA.from(TABLE).select('quantity').eq('id', rawRow.id).single()
  if (reread.quantity !== 3) fail('qty edit not persisted')
  console.log('6/8 · Edited qty 1→3')

  // RLS
  const { data: uB } = await SERVICE.auth.admin.createUser({ email: emailB, password, email_confirm: true })
  created.push(uB.user.id)
  const clientB = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
  await clientB.auth.signInWithPassword({ email: emailB, password })
  const { data: bSees } = await clientB.from(TABLE).select('id').eq('user_id', uA.user.id)
  if (bSees && bSees.length > 0) fail('RLS leak: user B saw user A rows')
  console.log('7/8 · RLS isolation confirmed')

  // Delete
  const { error: delErr } = await clientA.from(TABLE).delete().eq('id', rawRow.id)
  if (delErr) fail(`delete: ${delErr.message}`)
  console.log('8/8 · Deleted a row')
  console.log('\nPASS · YGO Collection E2E clean.')
} finally {
  await cleanup()
}
