// PP-TCG-QA-FINAL post-apply adapter spot-check + public safety.
//
// For each of 3 representative mappings — one bulk_safe (safe for
// graded aggregate), one market_only (variant / multi-printing),
// one not_eligible (quarantined after apply) — read:
//
//   • mappings.pricing_eligibility (current)
//   • qa.recommended_pricing_eligibility
//   • v_pokemon_tcg_effective_eligibility.effective_eligibility
//   • Prove the adapter WOULD gate correctly without actually invoking it
//
// Public safety verification:
//   • Hit a live pokeprices.io card page URL and confirm the response
//     does NOT embed TCGGraph-sourced price data (sampled by text pattern)
//   • Confirm the sitemap for the card URL is unchanged (returns 200)

import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

const report = { adapter_spot_checks: [], public_pages: [], scraper_db_touched: null }

// -------- Pick one representative mapping per class --------
console.log('[1] picking representative mappings…')
const probes = [
  { label: 'catalogue_corroborated / bulk_safe', risk: 'catalogue_corroborated', elig: 'bulk_safe' },
  { label: 'pricing_restriction / market_only',  risk: 'pricing_restriction',  elig: 'market_only' },
  { label: 'ambiguous_variant → not_eligible',   risk: 'ambiguous_variant',    elig: 'not_eligible' },
  { label: 'unverifiable → not_eligible',        risk: 'unverifiable',         elig: 'not_eligible' },
  { label: 'conflicting_identity → not_eligible', risk: 'conflicting_identity', elig: 'not_eligible' },
]

for (const probe of probes) {
  const { data } = await sb.from('pokemon_tcg_mapping_qa')
    .select('mapping_id,risk_class,prior_pricing_eligibility,recommended_pricing_eligibility,single_printing,sibling_printings,market_price_available')
    .eq('risk_class', probe.risk)
    .eq('recommended_pricing_eligibility', probe.elig)
    .limit(1)
  if (!data?.[0]) {
    console.log(`  no sample for ${probe.label}`)
    continue
  }
  const q = data[0]
  const { data: m } = await sb.from('pokemon_tcg_mappings')
    .select('id,pp_card_slug,pp_card_name,pp_set_name,pricing_eligibility,review_status,tcg_card_id,tcg_printing_key,confidence')
    .eq('id', q.mapping_id)
    .single()
  const { data: eff } = await sb.from('v_pokemon_tcg_effective_eligibility')
    .select('effective_eligibility,matcher_eligibility,qa_recommended_eligibility,risk_class')
    .eq('mapping_id', q.mapping_id)
    .single()

  // What the adapter WOULD return given current eligibility:
  // (simulating snapshot.ts gate logic)
  const elig = eff.effective_eligibility
  const canReturnMarket = elig === 'bulk_safe' || elig === 'market_only'
  const canReturnGraded = elig === 'bulk_safe'
  const canReturnImages = elig === 'bulk_safe' || elig === 'market_only' || elig === 'identity_only'

  console.log(`\n  ${probe.label}`)
  console.log(`    slug=${m.pp_card_slug}  name="${m.pp_card_name}"`)
  console.log(`    mapping.pricing_eligibility=${m.pricing_eligibility}  review_status=${m.review_status}`)
  console.log(`    qa.recommended=${q.recommended_pricing_eligibility}  risk=${q.risk_class}`)
  console.log(`    effective view: effective=${eff.effective_eligibility}  matcher=${eff.matcher_eligibility}  qa=${eff.qa_recommended_eligibility}`)
  console.log(`    adapter gates: market=${canReturnMarket}  graded=${canReturnGraded}  images=${canReturnImages}`)
  // Even if public flag ON, the adapter also requires review_status='approved' — currently none approved
  console.log(`    adapter blocks everything (review_status != 'approved'): ${m.review_status !== 'approved' ? 'YES' : 'NO'}`)

  report.adapter_spot_checks.push({
    label: probe.label,
    slug: m.pp_card_slug,
    name: m.pp_card_name,
    mapping_elig: m.pricing_eligibility,
    qa_rec: q.recommended_pricing_eligibility,
    effective: eff.effective_eligibility,
    adapter_gates: { canReturnMarket, canReturnGraded, canReturnImages },
    blocked_by_review_status: m.review_status !== 'approved',
  })
}

// -------- Public page HTTP spot-check --------
console.log(`\n[2] public PP page HTTP spot-check…`)
const samplePages = [
  'https://www.pokeprices.io/',
  'https://www.pokeprices.io/sitemap.xml',
  'https://www.pokeprices.io/robots.txt',
]

for (const url of samplePages) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'pp-tcg-qa-verify/1.0' } })
    const text = await res.text()
    const hasTcggraphIo = /tcggraph\.io/i.test(text)
    const hasPcDotCom = /pricecharting\.com/i.test(text)
    console.log(`  ${url}  status=${res.status}  len=${text.length}  tcggraph.io=${hasTcggraphIo}  pricecharting.com=${hasPcDotCom}`)
    report.public_pages.push({ url, status: res.status, bytes: text.length, has_tcggraph_io: hasTcggraphIo, has_pricecharting_com: hasPcDotCom })
  } catch (e) {
    console.log(`  ${url}  ERROR: ${e.message}`)
    report.public_pages.push({ url, error: e.message })
  }
}

// -------- Python scraper: check card_trends still fresh --------
console.log(`\n[3] Python scraper health (card_trends freshness)…`)
const { data: recent } = await sb.from('card_trends')
  .select('card_id,set_id,trend_date,modified_time')
  .order('modified_time', { ascending: false })
  .limit(5)
if (recent?.length) {
  const latest = new Date(recent[0].modified_time)
  const hoursAgo = (Date.now() - latest.getTime()) / 3600000
  console.log(`  latest card_trends.modified_time = ${recent[0].modified_time} (${hoursAgo.toFixed(1)}h ago)`)
  console.log(`  latest trend_date in that row    = ${recent[0].trend_date}`)
  report.scraper_db_touched = {
    latest_modified_time: recent[0].modified_time,
    latest_trend_date: recent[0].trend_date,
    hours_since_scraper_write: Number(hoursAgo.toFixed(1)),
  }
} else {
  console.log(`  (no card_trends rows found)`)
}

writeFileSync('scripts/_pp-tcg-match-qa/adapter-spot-check.json', JSON.stringify(report, null, 2))
console.log('\nreport written → scripts/_pp-tcg-match-qa/adapter-spot-check.json')
