// PP-TCG-500-PREP (correction §1) — authoritative catalogue counts.
// READ-ONLY. Uses the public anon key (safe by design) against the
// reconciliation view + cards table. No credentials in source.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const anon = readFileSync('/tmp/anon.key', 'utf-8').trim()
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co', anon, { auth: { persistSession: false } })

async function fullCount(table, filter = q => q) {
  const { count, error } = await filter(sb.from(table).select('*', { count: 'exact', head: true }))
  return { count, error: error?.message }
}

console.log('=== 1. public.cards baseline ===')
console.log('total cards       :', (await fullCount('cards')).count)
console.log('is_sealed=true    :', (await fullCount('cards', q => q.eq('is_sealed', true))).count)
console.log('is_sealed=false   :', (await fullCount('cards', q => q.eq('is_sealed', false))).count)
console.log('is_sealed is null :', (await fullCount('cards', q => q.is('is_sealed', null))).count)
console.log('is_sealed <> true :', (await fullCount('cards', q => q.not('is_sealed', 'is', true))).count)

console.log('\n=== 2. v_pp_tcg_card_reconciliation ===')
console.log('total rows        :', (await fullCount('v_pp_tcg_card_reconciliation')).count)
console.log('with gsc_rank     :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.not('gsc_rank', 'is', null))).count)
console.log('outcome=approved_active                :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'approved_active'))).count)
console.log('outcome=identity_safe_pending_review   :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'identity_safe_pending_review'))).count)
console.log('outcome=unmatched                      :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'unmatched'))).count)
console.log('outcome=no_tcg_equivalent              :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'no_tcg_equivalent'))).count)
console.log('outcome=ambiguous_variant              :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'ambiguous_variant'))).count)
console.log('outcome=unverifiable                   :', (await fullCount('v_pp_tcg_card_reconciliation', q => q.eq('outcome', 'unverifiable'))).count)

console.log('\n=== 3. Strict candidate pool (full count) ===')
const strict = async (filter) => (await fullCount('v_pp_tcg_card_reconciliation', q => {
  let x = q.eq('outcome', 'approved_active')
    .eq('risk_class', 'catalogue_corroborated')
    .eq('confidence', 'verified')
    .eq('review_status', 'approved')
    .eq('printing_active_status', 'active')
    .eq('has_image', true)
    .eq('has_market_prices', true)
    .eq('has_graded_prices', true)
    .in('effective_eligibility', ['bulk_safe','market_only'])
  return filter ? filter(x) : x
})).count
console.log('strict candidates (all)     :', await strict())
console.log('strict + has gsc_rank       :', await strict(q => q.not('gsc_rank', 'is', null)))
console.log('strict + no gsc_rank        :', await strict(q => q.is('gsc_rank', null)))

console.log('\n=== 4. Pilot cohort state ===')
console.log('cohort rows total           :', (await fullCount('pokemon_tcg_pilot_cohort')).count)
console.log('cohort prices_enabled=true  :', (await fullCount('pokemon_tcg_pilot_cohort', q => q.eq('prices_enabled', true))).count)
console.log('cohort prices_enabled=false :', (await fullCount('pokemon_tcg_pilot_cohort', q => q.eq('prices_enabled', false))).count)

console.log('\n=== 5. Net-new strict GSC-ranked (candidate set for 348) ===')
// We can't do SELECT ... NOT IN (subquery) via PostgREST easily; fetch both sets + diff.
const { data: cohortSlugs } = await sb.from('pokemon_tcg_pilot_cohort').select('pp_card_slug')
const cohortSet = new Set((cohortSlugs ?? []).map(r => r.pp_card_slug))
console.log('existing cohort slugs       :', cohortSet.size)

// Paginate strict + ranked list
async function fetchAllStrictRanked() {
  const out = []; let from = 0
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
    if (error) { console.error(error); break }
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}
const strictRanked = await fetchAllStrictRanked()
console.log('strict + ranked (paginated) :', strictRanked.length)
const netNew = strictRanked.filter(r => !cohortSet.has(r.pp_card_slug))
console.log('net-new (not in cohort)     :', netNew.length)
const alreadyInCohort = strictRanked.length - netNew.length
console.log('overlap with cohort         :', alreadyInCohort)
const byElig = {}; for (const r of netNew) byElig[r.effective_eligibility] = (byElig[r.effective_eligibility] || 0) + 1
console.log('net-new by eligibility      :', byElig)
const byLang = {}; for (const r of netNew) byLang[r.pp_language] = (byLang[r.pp_language] || 0) + 1
console.log('net-new by language         :', byLang)
console.log('\nfirst 25 net-new by GSC rank:')
for (const r of netNew.slice(0, 25)) console.log(`  rank ${String(r.gsc_rank).padStart(4)}  ${r.pp_card_slug.padEnd(10)}  ${(r.pp_set_name||'').padEnd(28)}  ${r.effective_eligibility}`)

// Thin + pending guards
const THIN = ['2677929','3468740','6903541','6903528']
console.log('\n=== 6. Guard-rail checks ===')
console.log('thin-data in net-new (expect 0):', netNew.filter(r => THIN.includes(r.pp_card_slug)).length)
// pending-mappings guard: 577 pending mappings must NEVER be in strict candidates
const { count: pendingInStrict } = await sb.from('v_pp_tcg_card_reconciliation').select('*', { count: 'exact', head: true })
  .eq('outcome', 'identity_safe_pending_review')
  .eq('risk_class', 'catalogue_corroborated')
  .eq('confidence', 'verified')
  .eq('review_status', 'approved')
console.log('577-pending AND approved_active (contradictory, expect 0):', pendingInStrict)
