// PP-TCG-500-PREP final preview — identify the exact 5 slugs the admin
// button would activate on first click. READ-ONLY mirror of
// selectNextExpansionBatch(sb, 5) in src/app/admin/pilot/batch/page.tsx.

import '../_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co', process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const MARKER = 'PP-TCG-500-PREP · GSC-ranked'
const THIN = new Set(['2677929','3468740','6903541','6903528'])

// (1) All staged, disabled, marked rows
const { data: staged, error: sErr } = await sb.from('pokemon_tcg_pilot_cohort')
  .select('pp_card_slug')
  .eq('prices_enabled', false)
  .like('notes', `${MARKER}%`)
if (sErr) throw new Error(sErr.message)
const stagedSlugs = (staged ?? []).map(r => r.pp_card_slug).filter(s => !THIN.has(s))
console.log(`staged candidates in pool: ${stagedSlugs.length}`)

// (2) Reconciliation view strict re-check
const rechecked = []
for (let i = 0; i < stagedSlugs.length; i += 100) {
  const chunk = stagedSlugs.slice(i, i + 100)
  const { data } = await sb.from('v_pp_tcg_card_reconciliation')
    .select('pp_card_slug,outcome,risk_class,confidence,review_status,printing_active_status,has_image,has_market_prices,has_graded_prices,effective_eligibility,gsc_rank,pp_card_name,pp_set_name,pp_language')
    .in('pp_card_slug', chunk)
  rechecked.push(...(data ?? []))
}

// (3) GLOBAL sort by gsc_rank ASC
rechecked.sort((a, b) => (a.gsc_rank ?? Number.MAX_SAFE_INTEGER) - (b.gsc_rank ?? Number.MAX_SAFE_INTEGER))

// (4) Strict re-check in rank order, take first 5
const SIZE = 5
const slugs = [], rejected = []
for (const r of rechecked) {
  if (slugs.length >= SIZE) break
  if (r.outcome !== 'approved_active')           { rejected.push({ slug:r.pp_card_slug, reason:`outcome=${r.outcome}` }); continue }
  if (r.risk_class !== 'catalogue_corroborated') { rejected.push({ slug:r.pp_card_slug, reason:`risk=${r.risk_class}` }); continue }
  if (r.confidence !== 'verified')               { rejected.push({ slug:r.pp_card_slug, reason:`conf=${r.confidence}` }); continue }
  if (r.review_status !== 'approved')            { rejected.push({ slug:r.pp_card_slug, reason:`review=${r.review_status}` }); continue }
  if (r.printing_active_status !== 'active')     { rejected.push({ slug:r.pp_card_slug, reason:`printing=${r.printing_active_status}` }); continue }
  if (!r.has_image || !r.has_market_prices || !r.has_graded_prices) { rejected.push({ slug:r.pp_card_slug, reason:'missing_asset' }); continue }
  if (!['bulk_safe','market_only'].includes(r.effective_eligibility)) { rejected.push({ slug:r.pp_card_slug, reason:`elig=${r.effective_eligibility}` }); continue }
  slugs.push(r)
}

console.log(`\nnext 5 by GSC rank (what the admin button will activate):`)
for (const r of slugs) {
  console.log(`  rank ${String(r.gsc_rank).padStart(4)}  ${r.pp_card_slug.padEnd(10)}  ${r.pp_card_name.padEnd(30)}  ${r.pp_set_name.padEnd(28)}  lang=${r.pp_language}  elig=${r.effective_eligibility}`)
}
console.log(`\nrejected (strict re-check): ${rejected.length}`)
if (rejected.length) for (const r of rejected.slice(0,10)) console.log(`  ${r.slug}: ${r.reason}`)
