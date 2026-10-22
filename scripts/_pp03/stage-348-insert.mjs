// PP-TCG-500-PREP-2 — fresh count + idempotent staging INSERT.
//
// Flow:
//   1. Fresh read-only count against the reconciliation view with the
//      strict provider-safe filter + gsc_rank NOT NULL + NOT IN cohort
//      must return exactly 348 before any writes.
//   2. Execute the INSERT with ON CONFLICT DO NOTHING so a re-run is
//      a no-op. Every new row starts with prices_enabled=false,
//      images_enabled=false, history_enabled=false, notes marker.
//   3. Verify post-state: 18 original cohort rows unchanged (14 live
//      prices=true + 4 thin prices=false), 348 new rows inserted
//      with all three flags false and the PP-TCG-500-PREP notes
//      marker, and no mutation to any other row.
//
// Credentials: service_role from .env.local via scripts/_lib/load-env.mjs.
// Never echoed. Only writes to pokemon_tcg_pilot_cohort.

import '../_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const EXPECTED_INSERT_COUNT = 348
const NOTES_PREFIX = 'PP-TCG-500-PREP · GSC-ranked'

// ---------------- Step 1: Fresh read-only count ----------------
console.log('STEP 1 — fresh read-only candidate count')

async function fetchStrictRankedCandidates() {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await sb.from('v_pp_tcg_card_reconciliation')
      .select('pp_card_slug,gsc_rank,pp_set_name,pp_language,effective_eligibility')
      .eq('outcome', 'approved_active')
      .eq('risk_class', 'catalogue_corroborated')
      .eq('confidence', 'verified')
      .eq('review_status', 'approved')
      .eq('printing_active_status', 'active')
      .eq('has_image', true)
      .eq('has_market_prices', true)
      .eq('has_graded_prices', true)
      .in('effective_eligibility', ['bulk_safe', 'market_only'])
      .not('gsc_rank', 'is', null)
      .order('gsc_rank', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`reconciliation view: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

const strictRanked = await fetchStrictRankedCandidates()
console.log(`  strict + GSC-ranked: ${strictRanked.length} (expect 360)`)

const { data: cohortRows, error: cohortErr } = await sb.from('pokemon_tcg_pilot_cohort')
  .select('pp_card_slug,prices_enabled,images_enabled,history_enabled,notes,activated_at,deactivated_at')
if (cohortErr) throw new Error(`cohort read: ${cohortErr.message}`)
const cohortBefore = new Map((cohortRows ?? []).map(r => [r.pp_card_slug, r]))
console.log(`  cohort rows before: ${cohortBefore.size}`)

const netNew = strictRanked.filter(r => !cohortBefore.has(r.pp_card_slug))
console.log(`  net-new candidates (NOT in cohort): ${netNew.length}`)

// Sealed guard-rail: re-join to cards to assert is_sealed is not true for the 348
const netNewSlugs = netNew.map(r => r.pp_card_slug)
async function fetchCardsSealed(slugs) {
  const out = new Map()
  for (let i = 0; i < slugs.length; i += 100) {
    const chunk = slugs.slice(i, i + 100)
    const { data } = await sb.from('cards').select('card_slug,is_sealed').in('card_slug', chunk)
    for (const c of (data ?? [])) out.set(c.card_slug, c.is_sealed)
  }
  return out
}
const sealedMap = await fetchCardsSealed(netNewSlugs)
const sealedLeak = netNew.filter(r => sealedMap.get(r.pp_card_slug) === true)
console.log(`  sealed leak check (expect 0): ${sealedLeak.length}`)
const thinLeak = netNew.filter(r => ['2677929','3468740','6903541','6903528'].includes(r.pp_card_slug))
console.log(`  thin-data leak (expect 0): ${thinLeak.length}`)

if (netNew.length !== EXPECTED_INSERT_COUNT) {
  console.error(`\nABORT — net-new candidate count ${netNew.length} ≠ expected ${EXPECTED_INSERT_COUNT}. No writes performed.`)
  process.exit(1)
}
if (sealedLeak.length !== 0 || thinLeak.length !== 0) {
  console.error('\nABORT — sealed or thin-data leak detected. No writes performed.')
  process.exit(2)
}
console.log(`  ✓ pre-INSERT guard-rails all pass. Proceeding to write ${netNew.length} rows.`)

// ---------------- Step 2: Idempotent INSERT ----------------
console.log('\nSTEP 2 — idempotent INSERT (ON CONFLICT DO NOTHING)')

const rowsToInsert = netNew.map(r => ({
  pp_card_slug:    r.pp_card_slug,
  prices_enabled:  false,
  images_enabled:  false,
  history_enabled: false,
  notes:           `${NOTES_PREFIX} · rank=${r.gsc_rank}`,
}))

// upsert with ignoreDuplicates:true on the unique pp_card_slug constraint ≡ ON CONFLICT DO NOTHING.
// Chunk because PostgREST has a request-size limit.
let inserted = 0
for (let i = 0; i < rowsToInsert.length; i += 200) {
  const chunk = rowsToInsert.slice(i, i + 200)
  const { data, error } = await sb.from('pokemon_tcg_pilot_cohort')
    .upsert(chunk, { onConflict: 'pp_card_slug', ignoreDuplicates: true })
    .select('pp_card_slug')
  if (error) {
    console.error(`  INSERT chunk ${i}..${i + chunk.length}: ERROR ${error.message}`)
    process.exit(3)
  }
  inserted += data?.length ?? 0
}
console.log(`  rows reported inserted by Supabase: ${inserted} (upsert with ignoreDuplicates may report differently; verifying below)`)

// ---------------- Step 3: Post-state verification ----------------
console.log('\nSTEP 3 — post-state verification')
const { data: cohortAfter } = await sb.from('pokemon_tcg_pilot_cohort')
  .select('pp_card_slug,prices_enabled,images_enabled,history_enabled,notes,activated_at,deactivated_at')
const afterMap = new Map((cohortAfter ?? []).map(r => [r.pp_card_slug, r]))
console.log(`  cohort rows after: ${afterMap.size}  (expect ${cohortBefore.size + EXPECTED_INSERT_COUNT} = ${cohortBefore.size + EXPECTED_INSERT_COUNT})`)

// 3a. Every one of the 348 slugs is now present with all three flags false
let newRowsOk = 0, newRowsBad = []
for (const r of netNew) {
  const after = afterMap.get(r.pp_card_slug)
  if (!after) { newRowsBad.push({ slug: r.pp_card_slug, reason: 'missing after insert' }); continue }
  if (after.prices_enabled !== false)  { newRowsBad.push({ slug: r.pp_card_slug, reason: 'prices_enabled≠false' });  continue }
  if (after.images_enabled !== false)  { newRowsBad.push({ slug: r.pp_card_slug, reason: 'images_enabled≠false' });  continue }
  if (after.history_enabled !== false) { newRowsBad.push({ slug: r.pp_card_slug, reason: 'history_enabled≠false' }); continue }
  if (!after.notes || !after.notes.startsWith(NOTES_PREFIX)) { newRowsBad.push({ slug: r.pp_card_slug, reason: `notes marker missing: ${after.notes}` }); continue }
  newRowsOk++
}
console.log(`  new rows with correct flags+marker: ${newRowsOk} / ${EXPECTED_INSERT_COUNT}`)
if (newRowsBad.length) {
  console.log(`  new rows FAILED verification: ${newRowsBad.length}`)
  for (const b of newRowsBad.slice(0, 10)) console.log(`    - ${b.slug}: ${b.reason}`)
}

// 3b. Every one of the pre-existing cohort rows is UNCHANGED
let preservedOk = 0, preservedBad = []
for (const [slug, before] of cohortBefore) {
  const after = afterMap.get(slug)
  if (!after) { preservedBad.push({ slug, reason: 'row disappeared' }); continue }
  const samePrices  = before.prices_enabled  === after.prices_enabled
  const sameImages  = before.images_enabled  === after.images_enabled
  const sameHistory = before.history_enabled === after.history_enabled
  const sameNotes   = (before.notes ?? null) === (after.notes ?? null)
  if (!samePrices || !sameImages || !sameHistory || !sameNotes) {
    preservedBad.push({ slug, reason: `prices=${samePrices} images=${sameImages} history=${sameHistory} notes=${sameNotes}` })
    continue
  }
  preservedOk++
}
console.log(`  original cohort rows preserved: ${preservedOk} / ${cohortBefore.size}`)
if (preservedBad.length) {
  console.log(`  original cohort rows MUTATED: ${preservedBad.length}`)
  for (const b of preservedBad) console.log(`    - ${b.slug}: ${b.reason}`)
}

// 3c. The 14 known-live and 4 known-thin rows explicitly verified
const KNOWN_LIVE = ['5732721','12368556','889380','3449535','12368493','13025625','11830160','13025579','11197498','5732710','6770012','849472','7445267','5952701']
const KNOWN_THIN = ['2677929','3468740','6903541','6903528']
console.log('\n  explicit guard-rail audit:')
let liveOk = 0, liveMutated = []
for (const slug of KNOWN_LIVE) {
  const a = afterMap.get(slug)
  if (!a) { liveMutated.push({ slug, reason: 'missing' }); continue }
  if (a.prices_enabled !== true) liveMutated.push({ slug, reason: `prices_enabled=${a.prices_enabled}` })
  else if (a.images_enabled !== false || a.history_enabled !== false) liveMutated.push({ slug, reason: `image/history flipped` })
  else liveOk++
}
console.log(`    14 live cards still prices_enabled=true, images/history=false: ${liveOk}/14`)
if (liveMutated.length) for (const m of liveMutated) console.log(`      ✗ ${m.slug}: ${m.reason}`)
let thinOk = 0, thinMutated = []
for (const slug of KNOWN_THIN) {
  const a = afterMap.get(slug)
  if (!a) { thinMutated.push({ slug, reason: 'missing' }); continue }
  if (a.prices_enabled !== false || a.images_enabled !== false || a.history_enabled !== false) thinMutated.push({ slug, reason: `flags=p${a.prices_enabled}/i${a.images_enabled}/h${a.history_enabled}` })
  else thinOk++
}
console.log(`    4 thin-data cards still all-flags-false: ${thinOk}/4`)
if (thinMutated.length) for (const m of thinMutated) console.log(`      ✗ ${m.slug}: ${m.reason}`)

// 3d. First 10 inserted rows (by gsc_rank)
console.log('\n  first 10 inserted rows (by gsc_rank):')
for (const r of netNew.slice(0, 10)) {
  const a = afterMap.get(r.pp_card_slug)
  console.log(`    rank ${String(r.gsc_rank).padStart(4)} ${r.pp_card_slug.padEnd(10)} ${(r.pp_set_name||'').padEnd(28)} p=${a?.prices_enabled} i=${a?.images_enabled} h=${a?.history_enabled}  notes="${a?.notes}"`)
}

const allOk = newRowsBad.length === 0 && preservedBad.length === 0 && liveMutated.length === 0 && thinMutated.length === 0
console.log(`\n${allOk ? '✓ VERIFIED' : '✗ VERIFICATION FAILED'} — ${newRowsOk} new rows inserted; ${preservedOk} original rows preserved.`)
process.exit(allOk ? 0 : 4)
