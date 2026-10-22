// PP-TCG-500 — gather candidate set + exclusions for the first 500-card
// migration proposal. READ-ONLY. No cohort writes, no activation.
import '../_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})

async function fetchAll(table, select, filter=q=>q, order='pp_card_slug'){
  const out=[]; let from=0
  while(true){ const {data,error}=await filter(sb.from(table).select(select).order(order)).range(from,from+999)
    if(error){console.error(error);break}; if(!data||!data.length) break
    out.push(...data); if(data.length<1000)break; from+=1000 }
  return out
}

// Pull from v_pp_tcg_card_reconciliation to get everything joined
const rec = await fetchAll(
  'v_pp_tcg_card_reconciliation',
  'pp_card_slug,pp_card_name,pp_set_name,pp_language,outcome,risk_class,confidence,review_status,matcher_eligibility,qa_recommended_eligibility,effective_eligibility,printing_active_status,has_image,has_market_prices,has_graded_prices,gsc_rank',
  q => q.not('gsc_rank','is',null).order('gsc_rank', {ascending:true}),
  'gsc_rank'
)
console.log('rows with gsc_rank:', rec.length)

// Candidate predicate (strict approved-active, provider-safe)
function isCandidate(r) {
  return r.outcome === 'approved_active'
    && r.risk_class === 'catalogue_corroborated'
    && r.confidence === 'verified'
    && r.review_status === 'approved'
    && r.printing_active_status === 'active'
    && r.has_image === true
    && r.has_market_prices === true
    && r.has_graded_prices === true
    && ['bulk_safe','market_only'].includes(r.effective_eligibility)
}

// Classify ALL ranked rows into: candidate / excluded (by reason)
const classified = []
for (const r of rec) {
  const reasons = []
  if (r.outcome !== 'approved_active') reasons.push(`outcome=${r.outcome}`)
  if (r.risk_class !== 'catalogue_corroborated') reasons.push(`risk=${r.risk_class}`)
  if (r.confidence !== 'verified') reasons.push(`conf=${r.confidence}`)
  if (r.review_status !== 'approved') reasons.push(`review=${r.review_status}`)
  if (r.printing_active_status !== 'active') reasons.push(`printing=${r.printing_active_status}`)
  if (r.has_image !== true) reasons.push('no_image')
  if (r.has_market_prices !== true) reasons.push('no_market')
  if (r.has_graded_prices !== true) reasons.push('no_graded')
  if (!['bulk_safe','market_only'].includes(r.effective_eligibility)) reasons.push(`elig=${r.effective_eligibility}`)
  classified.push({ ...r, candidate: reasons.length === 0, exclusion_reasons: reasons })
}

const candidates = classified.filter(c => c.candidate)
console.log('candidates (strict provider-safe):', candidates.length)
console.log('excluded ranked rows:', classified.length - candidates.length)

// Take top 500 by gsc_rank
const top500 = candidates.slice(0, 500)
console.log('\nTop 500 candidate stats:')
console.log('  rank range:', top500[0]?.gsc_rank, '..', top500[top500.length-1]?.gsc_rank)
const byElig = {}; for (const t of top500) byElig[t.effective_eligibility]=(byElig[t.effective_eligibility]||0)+1
console.log('  eligibility:', byElig)
const byLang = {}; for (const t of top500) byLang[t.pp_language]=(byLang[t.pp_language]||0)+1
console.log('  language:', byLang)
const bySet = {}; for (const t of top500) bySet[t.pp_set_name]=(bySet[t.pp_set_name]||0)+1
const topSets = Object.entries(bySet).sort((a,b)=>b[1]-a[1]).slice(0,10)
console.log('  top sets by count:')
for (const [s,c] of topSets) console.log(`    ${c.toString().padStart(4)}  ${s}`)

// Exclusions among ranks 1..~500+ that failed strict filter
const excludedInRange = classified.filter(c => !c.candidate && c.gsc_rank <= (top500[top500.length-1]?.gsc_rank || 831))
console.log('\nExcluded ranked rows within the GSC range needed to collect 500:', excludedInRange.length)
const excReasons = {}
for (const e of excludedInRange) {
  const key = e.exclusion_reasons.join(' + ')
  excReasons[key] = (excReasons[key] || 0) + 1
}
console.log('  reasons:')
for (const [k,v] of Object.entries(excReasons).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`    ${v.toString().padStart(4)}  ${k}`)

// Already-activated (14 slugs) overlap check
const ACTIVATED = new Set(['5732721','12368556','889380','3449535','12368493','13025625','11830160','13025579','11197498','5732710','6770012','849472','7445267','5952701'])
const overlap = top500.filter(t => ACTIVATED.has(t.pp_card_slug))
console.log(`\nOverlap with 14 activated: ${overlap.length}/14 (expected: those with gsc_rank ≤ ${top500[top500.length-1]?.gsc_rank})`)
for (const o of overlap) console.log(`  rank ${o.gsc_rank} ${o.pp_card_slug} ${o.pp_card_name}`)

// Thin-data (B2) overlap — should NOT be in top 500 as candidates
const THIN = new Set(['2677929','3468740','6903541','6903528'])
const thinInCandidates = top500.filter(t => THIN.has(t.pp_card_slug))
console.log(`\nThin-data in top 500 candidates (expected 0 if gsc_rank null for them): ${thinInCandidates.length}`)

// 577 pending — none should be in candidates (they're pending_review, not approved)
const pending577 = classified.filter(c => c.outcome === 'identity_safe_pending_review')
console.log(`\n'identity_safe_pending_review' rows with gsc_rank: ${pending577.length}`)
console.log(`  → NONE of these appear in candidates (verified: ${pending577.filter(p => p.candidate).length} should be 0)`)

// Write top500 to file
const fs = await import('node:fs')
fs.writeFileSync('scripts/_pp03/top500-candidates.json', JSON.stringify(top500.map(t => ({
  gsc_rank: t.gsc_rank, pp_card_slug: t.pp_card_slug, pp_card_name: t.pp_card_name, pp_set_name: t.pp_set_name, pp_language: t.pp_language, effective_eligibility: t.effective_eligibility
})), null, 2))
console.log('\nSaved top 500 → scripts/_pp03/top500-candidates.json')

// Rank-gap check: list the first 10 excluded ranks so we see what's being dropped
console.log('\nFirst 10 excluded ranked rows (ranks that will be SKIPPED):')
for (const e of excludedInRange.slice(0,10)) console.log(`  rank ${(e.gsc_rank||'-').toString().padStart(4)} ${e.pp_card_slug.padEnd(10)} ${e.pp_card_name?.padEnd(28)} [${e.exclusion_reasons.join(', ')}]`)
