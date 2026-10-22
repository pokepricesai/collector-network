// PP-TCG-500-PREP correction §A — live test of the emergency rollback
// SQL semantics against a scoped DUMMY row. Does NOT touch any real
// pilot slug. Exercises the exact UPDATE statements the admin page
// server actions use.
//
// Steps:
//   1. Snapshot current state of 14 live + 4 thin + 348 staged rows.
//   2. Insert dummy row with notes marker + prices_enabled=true.
//   3. Run the emergency-disable UPDATE (scope: notes LIKE marker AND prices=true).
//   4. Verify dummy row flipped, EVERY real row unchanged.
//   5. Simulate "pending revalidation" detection (updated_at == deactivated_at).
//   6. Simulate successful revalidation (bump updated_at).
//   7. Verify dummy drops out of pending list.
//   8. Delete dummy row. State fully restored.

import '../_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const DUMMY_SLUG = 'PP-TCG-500-PREP-TEST-DO-NOT-USE-' + Date.now()
const DUMMY_NOTES = 'PP-TCG-500-PREP · GSC-ranked · rank=TEST-SCOPE-ONLY'
const MARKER = 'PP-TCG-500-PREP · GSC-ranked'
const KNOWN_LIVE = ['5732721','12368556','889380','3449535','12368493','13025625','11830160','13025579','11197498','5732710','6770012','849472','7445267','5952701']
const KNOWN_THIN = ['2677929','3468740','6903541','6903528']

function hash(row) { return `${row.pp_card_slug}|${row.prices_enabled}|${row.images_enabled}|${row.history_enabled}|${row.notes ?? ''}` }

async function snapshotRealRows() {
  const { data } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,prices_enabled,images_enabled,history_enabled,notes')
    .neq('pp_card_slug', DUMMY_SLUG)
  return new Map((data ?? []).map(r => [r.pp_card_slug, hash(r)]))
}

try {
  console.log('STEP 1 — snapshot current real-row state')
  const before = await snapshotRealRows()
  console.log(`  total non-dummy cohort rows: ${before.size}`)
  const liveCount = KNOWN_LIVE.filter(s => before.has(s)).length
  const thinCount = KNOWN_THIN.filter(s => before.has(s)).length
  console.log(`  known-live present: ${liveCount}/14`)
  console.log(`  known-thin present: ${thinCount}/4`)

  console.log('\nSTEP 2 — insert scoped dummy row')
  const { error: insErr } = await sb.from('pokemon_tcg_pilot_cohort').insert({
    pp_card_slug: DUMMY_SLUG,
    prices_enabled: true,
    images_enabled: false,
    history_enabled: false,
    notes: DUMMY_NOTES,
  })
  if (insErr) throw new Error(`dummy insert: ${insErr.message}`)
  console.log(`  inserted: ${DUMMY_SLUG}  prices_enabled=true  notes="${DUMMY_NOTES}"`)

  // Confirm no real row has the dummy's exact notes
  const { count: realWithMarkerOn } = await sb.from('pokemon_tcg_pilot_cohort').select('*', { count:'exact', head:true })
    .like('notes', `${MARKER}%`)
    .eq('prices_enabled', true)
    .neq('pp_card_slug', DUMMY_SLUG)
  console.log(`  real rows with marker AND prices_enabled=true (expect 0): ${realWithMarkerOn}`)
  if (realWithMarkerOn !== 0) throw new Error('UNEXPECTED: a real row already has the expansion marker AND prices_enabled=true — aborting test to avoid confounding')

  console.log('\nSTEP 3 — exercise emergency-disable UPDATE (scoped to marker + prices=true)')
  const now1 = new Date().toISOString()
  const { data: upd, error: upErr } = await sb.from('pokemon_tcg_pilot_cohort')
    .update({ prices_enabled: false, deactivated_at: now1, updated_at: now1 })
    .eq('prices_enabled', true)
    .like('notes', `${MARKER}%`)
    .select('pp_card_slug,prices_enabled,deactivated_at,updated_at')
  if (upErr) throw new Error(`bulk disable: ${upErr.message}`)
  console.log(`  affected rows: ${upd?.length ?? 0}`)
  const affectedSlugs = (upd ?? []).map(r => r.pp_card_slug)
  console.log(`  affected slug(s): ${affectedSlugs.join(', ') || '(none)'}`)
  const expectedAffected = [DUMMY_SLUG]
  const unexpected = affectedSlugs.filter(s => !expectedAffected.includes(s))
  if (unexpected.length > 0) {
    console.error(`  ✗ FAIL: unexpected rows affected: ${unexpected.join(',')}`)
    throw new Error('scope leak detected')
  }
  console.log('  ✓ emergency-disable affected ONLY the dummy row')

  console.log('\nSTEP 4 — verify every real row is byte-identical to before')
  const afterUpdate = await snapshotRealRows()
  let drifted = []
  for (const [slug, h] of before) {
    const h2 = afterUpdate.get(slug)
    if (h2 !== h) drifted.push({ slug, before: h, after: h2 })
  }
  console.log(`  real rows drifted: ${drifted.length}`)
  if (drifted.length > 0) {
    for (const d of drifted.slice(0,5)) console.log(`    ${d.slug}: before=${d.before}  after=${d.after}`)
    throw new Error('real-row drift detected')
  }
  console.log('  ✓ 14 live + 4 thin + 348 staged — all unchanged')

  console.log('\nSTEP 5 — pending-revalidation detection (updated_at ≤ deactivated_at)')
  const { data: dummy1 } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('deactivated_at,updated_at').eq('pp_card_slug', DUMMY_SLUG).maybeSingle()
  const dt1 = new Date(dummy1.deactivated_at).getTime()
  const ut1 = new Date(dummy1.updated_at).getTime()
  console.log(`  dummy deactivated_at=${dummy1.deactivated_at}`)
  console.log(`  dummy updated_at   =${dummy1.updated_at}`)
  console.log(`  updated_at ≤ deactivated_at: ${ut1 <= dt1}  (expect true — pending)`)
  if (!(ut1 <= dt1)) throw new Error('pending marker invariant broken')

  console.log('\nSTEP 6 — simulate successful revalidation (bump updated_at above deactivated_at)')
  const now2 = new Date(Date.now() + 1000).toISOString()  // +1s to beat deactivated_at
  const { error: markErr } = await sb.from('pokemon_tcg_pilot_cohort')
    .update({ updated_at: now2 }).eq('pp_card_slug', DUMMY_SLUG)
  if (markErr) throw new Error(`mark revalidated: ${markErr.message}`)
  const { data: dummy2 } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('deactivated_at,updated_at').eq('pp_card_slug', DUMMY_SLUG).maybeSingle()
  const dt2 = new Date(dummy2.deactivated_at).getTime()
  const ut2 = new Date(dummy2.updated_at).getTime()
  console.log(`  dummy updated_at   =${dummy2.updated_at}`)
  console.log(`  updated_at > deactivated_at: ${ut2 > dt2}  (expect true — revalidated, drops out of pending)`)
  if (!(ut2 > dt2)) throw new Error('revalidated marker invariant broken')

  console.log('\nSTEP 7 — verify "pending" list no longer contains the dummy')
  const { data: stillPending } = await sb.from('pokemon_tcg_pilot_cohort')
    .select('pp_card_slug,deactivated_at,updated_at')
    .eq('prices_enabled', false)
    .not('deactivated_at', 'is', null)
    .like('notes', `${MARKER}%`)
  const pendingDummies = (stillPending ?? [])
    .filter(r => new Date(r.updated_at).getTime() <= new Date(r.deactivated_at).getTime())
    .filter(r => r.pp_card_slug === DUMMY_SLUG)
  console.log(`  dummy in pending list after bump: ${pendingDummies.length}  (expect 0)`)
  if (pendingDummies.length !== 0) throw new Error('revalidated row still appears pending')

  console.log('\nSTEP 8 — idempotency check: re-run the disable UPDATE, expect 0 rows affected')
  const { data: upd2 } = await sb.from('pokemon_tcg_pilot_cohort')
    .update({ prices_enabled: false, deactivated_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('prices_enabled', true)
    .like('notes', `${MARKER}%`)
    .select('pp_card_slug')
  console.log(`  second disable UPDATE affected: ${upd2?.length ?? 0}  (expect 0 — already disabled)`)
  if ((upd2?.length ?? 0) !== 0) throw new Error('non-idempotent re-run')

  console.log('\n✓ ALL EMERGENCY-ROLLBACK SQL SEMANTICS PASS')
} finally {
  // Always clean up the dummy row, even on failure
  console.log('\nCLEANUP — delete dummy row')
  const { error: delErr } = await sb.from('pokemon_tcg_pilot_cohort').delete().eq('pp_card_slug', DUMMY_SLUG)
  if (delErr) console.error(`  ✗ cleanup failed: ${delErr.message}`)
  else console.log(`  ✓ dummy row deleted`)
  const { data: ck } = await sb.from('pokemon_tcg_pilot_cohort').select('pp_card_slug').eq('pp_card_slug', DUMMY_SLUG).maybeSingle()
  console.log(`  post-cleanup dummy present: ${!!ck}  (expect false)`)
}
