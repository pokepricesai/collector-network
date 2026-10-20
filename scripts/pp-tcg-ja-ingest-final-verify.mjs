// Single-pass final verification for PP-TCG-JA-INGEST-FINAL-VERIFY.
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

async function fetchAll(table, select, filterFn = q => q, order = 'tcg_card_id') {
  const out = []; let from = 0
  while (true) {
    const { data, error } = await filterFn(sb.from(table).select(select).order(order)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

console.log('UTC now:', new Date().toISOString())

// ========== CHECK 1 + 2 + 3 (via catalogue_version distribution) ==========
const all = await fetchAll('pokemon_tcg_provider_cards', 'tcg_set_code,tcg_language,catalogue_version,provider_status')
const migrate01 = all.filter(r => r.catalogue_version === '2026-10-18-pp-tcg-migrate-01')
const bySetM = {}
for (const r of migrate01) {
  const k = r.tcg_set_code + '|' + r.tcg_language
  if (!bySetM[k]) bySetM[k] = { active: 0, superseded: 0 }
  bySetM[k][r.provider_status]++
}
console.log('\n=== CHECK 1: migrate-01 residual (expected the 404 to refresh) ===')
console.log('  migrate-01 total still present:', migrate01.length)
for (const [k, v] of Object.entries(bySetM).sort((a, b) => (b[1].active + b[1].superseded) - (a[1].active + a[1].superseded))) {
  console.log('  ' + k.padEnd(16) + 'active=' + v.active + ' superseded=' + v.superseded)
}
for (const c of ['bw2|ja', 'bw4|ja', 'bw7|ja', 'bw9|ja']) {
  console.log('    required ' + c + ':', bySetM[c] ? ('leftover active=' + bySetM[c].active + ' superseded=' + bySetM[c].superseded) : 'FULLY REFRESHED (0 on migrate-01)')
}

console.log('\n=== CHECK 2: 843-cohort refresh (xyp/xy10/sv6/sm7/sm8 |ja) ===')
const T2 = ['xyp|ja', 'xy10|ja', 'sv6|ja', 'sm7|ja', 'sm8|ja']
for (const t of T2) {
  const [code, lang] = t.split('|')
  const rows = all.filter(r => r.tcg_set_code === code && r.tcg_language === lang)
  const today = rows.filter(r => r.catalogue_version === 'daily-2026-10-20').length
  const yesterday = rows.filter(r => r.catalogue_version === 'daily-2026-10-19').length
  const older = rows.filter(r => r.catalogue_version === 'daily-2026-10-18').length
  const sup = rows.filter(r => r.provider_status === 'superseded').length
  console.log('  ' + t.padEnd(10) + ' total=' + rows.length + ' today(10-20)=' + today + ' 10-19=' + yesterday + ' 10-18=' + older + ' superseded=' + sup)
}

console.log('\n=== CHECK 3: reclassification state ===')
const supAll = all.filter(r => r.provider_status === 'superseded')
console.log('  total superseded:', supAll.length)
const supWithReason = await fetchAll('pokemon_tcg_provider_cards', 'superseded_reason', q => q.eq('provider_status', 'superseded'))
const bySource = { cron: 0, operator: 0 }
for (const r of supWithReason) {
  if (r.superseded_reason?.startsWith('chunk cron')) bySource.cron++
  else bySource.operator++
}
console.log('  by reason source:', bySource)

console.log('\n=== CHECK 4: full (set, lang) inventory ===')
const obs = await fetchAll('pokemon_tcg_sets_observed', 'tcg_set_code,tcg_language', q => q, 'tcg_set_code')
const expectedPairs = new Set(obs.map(r => r.tcg_set_code + '|' + r.tcg_language))
console.log('  sets_observed unique pairs:', expectedPairs.size)
const todayPairs = new Set(all.filter(r => r.catalogue_version === 'daily-2026-10-20').map(r => r.tcg_set_code + '|' + r.tcg_language))
console.log('  pairs with daily-2026-10-20 provider_cards:', todayPairs.size)
const unprocessed = [...expectedPairs].filter(p => !todayPairs.has(p))
console.log('  pairs expected but NOT processed today:', unprocessed.length)
if (unprocessed.length > 0 && unprocessed.length <= 20) for (const p of unprocessed) console.log('    - ' + p)

console.log('\n=== CHECK 5: credit budget ===')
const runs = await fetchAll('pokemon_tcg_ingestion_runs', 'started_at,credits_spent,metadata',
  q => q.gte('started_at', '2026-10-20T00:00:00Z').lt('started_at', '2026-10-21T00:00:00Z'), 'started_at')
let sum = 0, lastRem = null, totalReclass = 0, totalScanned = 0
for (const r of runs) {
  if (r.credits_spent) sum += r.credits_spent
  if (r.metadata?.monthly_remaining != null) lastRem = r.metadata.monthly_remaining
  totalReclass += (r.metadata?.reclass_marked_superseded ?? 0)
  totalScanned += (r.metadata?.reclass_sets_scanned ?? 0)
}
console.log('  2026-10-20 chunk runs:', runs.length, 'credits sum:', sum, 'monthly_remaining:', lastRem)
console.log('  2026-10-20 reclass_marked_superseded total:', totalReclass, 'sets_scanned total:', totalScanned)

console.log('\n=== CHECK 6: mapping + pilot state ===')
const sup = await fetchAll('pokemon_tcg_provider_cards', 'tcg_card_id,tcg_printing_key', q => q.eq('provider_status', 'superseded'))
const supKeys = new Set(sup.map(r => r.tcg_card_id + '|' + r.tcg_printing_key))
const affected = []
let from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_mappings').select('pp_card_slug,pp_card_name,tcg_card_id,tcg_printing_key,pricing_eligibility,review_status').eq('review_status', 'approved').range(from, from + 999)
  if (!data || !data.length) break
  for (const m of data) if (m.tcg_card_id && m.tcg_printing_key && supKeys.has(m.tcg_card_id + '|' + m.tcg_printing_key)) affected.push(m)
  if (data.length < 1000) break; from += 1000
}
console.log('  approved mappings pointing at superseded printings:', affected.length)
for (const a of affected) console.log('    ' + a.pp_card_slug + ' | ' + a.pp_card_name + ' | ' + a.tcg_card_id + '|' + a.tcg_printing_key + ' elig=' + a.pricing_eligibility)
const { data: pilot } = await sb.from('pokemon_tcg_pilot_cohort').select('prices_enabled,images_enabled,history_enabled,deactivated_at')
const anyOn = pilot.filter(p => p.prices_enabled || p.images_enabled || p.history_enabled)
console.log('  pilot cohort: total=' + pilot.length + ' any_feature_on=' + anyOn.length)

// Darkrai EX #72 unchanged?
const { data: darkrai } = await sb.from('pokemon_tcg_mappings').select('pp_card_slug,tcg_card_id,tcg_printing_key,pricing_eligibility,review_status').eq('pp_card_slug', '3461618').single()
console.log('  Darkrai EX #72 (3461618):', JSON.stringify(darkrai))

// Public safety
const resp = await fetch('https://www.pokeprices.io/', { headers: { 'User-Agent': 'pp-verify/1.0' } })
const html = await resp.text()
const hasTcg = /tcggraph\.io/i.test(html)
console.log('  pokeprices.io status=' + resp.status + ' tcggraph.io ref=' + hasTcg)
const { data: scraper } = await sb.from('card_trends').select('as_of').order('as_of', { ascending: false }).limit(1)
console.log('  PriceCharting scraper latest card_trends.as_of:', scraper?.[0]?.as_of)
