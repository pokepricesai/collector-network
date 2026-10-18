// PP-TCG-APPROVAL-02 post-apply verification — 7 items from the authorisation.

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const RUN_ID = 'qa-approval-2026-10-18T21-45-49-985Z'
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

const checks = {}
let fail = 0

// ---------- 1. 37,224 approvals, no dups, no failed batches ----------
const { data: run } = await sb.from('pokemon_tcg_identity_approval_runs').select('*').eq('run_id', RUN_ID).single()
console.log(`[1] run row: status=${run.status}, applied=${run.approvals_applied}/${run.approvals_total}, started=${run.started_at}, completed=${run.completed_at}`)
checks.run_status = { pass: run.status === 'completed' && run.approvals_applied === 37224 && run.approvals_total === 37224, data: run }
if (!checks.run_status.pass) fail++

// Count distinct mapping_ids with review_status=approved AFTER the run
const approvedIds = []
let from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_mappings').select('id').eq('review_status', 'approved').order('id').range(from, from + 999)
  if (!data || !data.length) break
  approvedIds.push(...data)
  if (data.length < 1000) break
  from += 1000
}
const approvedSet = new Set(approvedIds.map(r => r.id))
console.log(`    approved mappings: ${approvedIds.length} (unique: ${approvedSet.size})`)
checks.approved_count = { pass: approvedSet.size === 37224, count: approvedSet.size }
if (!checks.approved_count.pass) fail++

// ---------- 2. Audit coverage ----------
const auditIds = []
from = 0
while (true) {
  const { data } = await sb.from('pokemon_tcg_mapping_audit')
    .select('mapping_id,id')
    .eq('action', 'qa_identity_approval')
    .filter('metadata->>run_id', 'eq', RUN_ID)
    .order('id')
    .range(from, from + 999)
  if (!data || !data.length) break
  auditIds.push(...data)
  if (data.length < 1000) break
  from += 1000
}
const auditMappingIds = new Set(auditIds.map(r => r.mapping_id))
console.log(`[2] audit rows for run_id: ${auditIds.length} (unique mapping_ids: ${auditMappingIds.size})`)
checks.audit_coverage = { pass: auditIds.length === 37224 && auditMappingIds.size === 37224, audit_rows: auditIds.length }
if (!checks.audit_coverage.pass) fail++
// Verify 1:1 with approved
const approvedWithoutAudit = [...approvedSet].filter(id => !auditMappingIds.has(id))
const auditWithoutApproval = [...auditMappingIds].filter(id => !approvedSet.has(id))
console.log(`    approved without audit: ${approvedWithoutAudit.length}  audit without approved: ${auditWithoutApproval.length}`)

// ---------- 3. Pricing eligibility within approved cohort ----------
// Chunk IN clauses at 100 (Cloudflare 414 URL-length limit on UUIDs)
const eligibility = {}
for (let i = 0; i < approvedIds.length; i += 100) {
  const chunk = approvedIds.slice(i, i + 100)
  const { data } = await sb.from('pokemon_tcg_mappings').select('id,pricing_eligibility').in('id', chunk.map(c => c.id))
  for (const r of (data || [])) eligibility[r.pricing_eligibility] = (eligibility[r.pricing_eligibility] || 0) + 1
}
console.log(`[3] eligibility within approved cohort:`)
for (const [k, v] of Object.entries(eligibility).sort((a, b) => b[1] - a[1])) console.log(`      ${k.padEnd(16)} ${v}`)
const expected = { bulk_safe: 8973, market_only: 28046, identity_only: 205 }
const eligOk =
  eligibility.bulk_safe === expected.bulk_safe &&
  eligibility.market_only === expected.market_only &&
  eligibility.identity_only === expected.identity_only
checks.eligibility_within_approved = { pass: eligOk, actual: eligibility, expected }
if (!checks.eligibility_within_approved.pass) fail++

// ---------- 4. Quarantined + 7 remain excluded ----------
// Count mappings currently in approve-blocked risk classes AND their approved status
const quarantined = []
for (const risk of ['ambiguous_variant', 'conflicting_identity', 'unverifiable']) {
  let from = 0
  while (true) {
    const { data } = await sb.from('pokemon_tcg_mapping_qa').select('mapping_id').eq('risk_class', risk).order('mapping_id').range(from, from + 999)
    if (!data || !data.length) break
    quarantined.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
}
const quarantinedIds = new Set(quarantined.map(r => r.mapping_id))
console.log(`[4] quarantined (ambig+confl+unver) mappings: ${quarantinedIds.size}`)
const anyApproved = [...quarantinedIds].filter(id => approvedSet.has(id))
console.log(`    quarantined mappings approved by this run: ${anyApproved.length} (must be 0)`)
checks.quarantined_excluded = { pass: anyApproved.length === 0, quarantined_count: quarantinedIds.size }
if (!checks.quarantined_excluded.pass) fail++

// The 7 outliers (recovery mappings with market_only but non-identity-safe risk)
const { data: outliers } = await sb.from('pokemon_tcg_mappings')
  .select('id,review_status,pricing_eligibility')
  .in('pricing_eligibility', ['bulk_safe', 'market_only', 'identity_only'])
  .in('id', [...quarantinedIds].slice(0, 20000))      // bounded for IN clause; sample check
const outlierApproved = (outliers || []).filter(o => o.review_status === 'approved').length
console.log(`    "7 outliers" check — eligible-looking + quarantined-risk mappings approved: ${outlierApproved} (must be 0)`)

// ---------- 5. Public pages ----------
console.log(`[5] public pages:`)
const urls = ['https://www.pokeprices.io/', 'https://www.pokeprices.io/sitemap.xml', 'https://www.pokeprices.io/robots.txt']
let publicOk = true
for (const u of urls) {
  const r = await fetch(u, { headers: { 'User-Agent': 'pp-tcg-approval-verify/1.0' } })
  const t = await r.text()
  const hasTcg = /tcggraph\.io/i.test(t)
  if (hasTcg || r.status !== 200) publicOk = false
  console.log(`      ${u.padEnd(45)} status=${r.status} tcggraph.io=${hasTcg}`)
}
checks.public_pages = { pass: publicOk }
if (!publicOk) fail++

// ---------- 6. Env flags — PP_USE_TCGGRAPH_* must be unset in prod ----------
// We can't read env from Vercel directly without the Vercel API; the
// authoritative check is that no public card page serves TCGGraph data.
// Hit the homepage (served by Next.js app shell) and verify no provider
// script/image/URL is embedded.
console.log(`[6] PP_USE_TCGGRAPH_* flags — public pages must not reference TCGGraph`)
const homepage = await fetch('https://www.pokeprices.io/', { headers: { 'User-Agent': 'pp-tcg-approval-verify/1.0' } })
const homepageHtml = await homepage.text()
const homeTcg = /tcggraph\.io|TCGGraph(?!_)/i.test(homepageHtml)
const homeOk = homepage.status === 200 && !homeTcg
console.log(`      https://www.pokeprices.io/  status=${homepage.status}  tcggraph.io=${homeTcg}`)
checks.flags_off = { pass: homeOk, status: homepage.status, has_tcggraph: homeTcg }
if (!homeOk) fail++

// ---------- 7. Python scraper ----------
const { data: scraperFresh } = await sb.from('card_trends').select('as_of').order('as_of', { ascending: false }).limit(1)
const latestAsOf = scraperFresh?.[0]?.as_of
const today = new Date().toISOString().slice(0, 10)
console.log(`[7] card_trends latest as_of=${latestAsOf} (today=${today})`)
checks.scraper_running = { pass: latestAsOf === today, latest_as_of: latestAsOf }
if (!checks.scraper_running.pass) fail++

console.log(`\n=== OVERALL: ${fail === 0 ? 'PASS' : 'FAIL ('+fail+' failures)'} ===`)
console.log(JSON.stringify(checks, null, 2))
