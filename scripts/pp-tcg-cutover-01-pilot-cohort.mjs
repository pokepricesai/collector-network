// PP-TCG-CUTOVER-PREP-01 §5 — select 10-20 high-confidence pilot
// cards across six requested categories. Does NOT activate anything
// in the pilot cohort table; writes a JSON file that the operator
// reviews before deciding whether to opt them in.
//
// --insert  → upserts the proposed cards into pokemon_tcg_pilot_cohort
//             with all features = false (operator still has to enable
//             prices/images/history per slug before any activation).

import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const INSERT = process.argv.includes('--insert')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnaWRwc3JrcXZ5bXZpb2lkYXRjIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTQxMDExNCwiZXhwIjoyMDg2OTg2MTE0fQ.NhTEq6glhmP2-lDNABRtD3U_aBE-ky_5VfP4z0OyWSc',
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-cutover', { recursive: true })

async function fetchAll(table, select, filter = (q) => q, orderCol = 'id') {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filter(sb.from(table).select(select).order(orderCol)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

// Candidates: approved mappings with high confidence, catalogue_corroborated,
// at least one market price source, image available.
console.log('[1/5] pulling approved + bulk_safe mappings + joining catalogue_corroborated QA…')
const approvedBulkRows = await fetchAll('pokemon_tcg_mappings',
  'id,pp_card_slug,pp_card_name,tcg_card_id,tcg_printing_key,tcg_language',
  q => q.eq('review_status', 'approved').eq('pricing_eligibility', 'bulk_safe').eq('confidence', 'verified'),
)
console.log(`     ${approvedBulkRows.length} approved + bulk_safe mappings`)

const corroboratedIds = new Set()
for (let i = 0; i < approvedBulkRows.length; i += 100) {
  const chunk = approvedBulkRows.slice(i, i + 100)
  const { data } = await sb.from('pokemon_tcg_mapping_qa')
    .select('mapping_id,risk_class')
    .in('mapping_id', chunk.map(c => c.id))
    .eq('risk_class', 'catalogue_corroborated')
  for (const r of (data || [])) corroboratedIds.add(r.mapping_id)
}
const bulkSafeApproved = approvedBulkRows.filter(r => corroboratedIds.has(r.id)).map(r => ({
  mapping_id: r.id,
  pp_card_slug: r.pp_card_slug,
  pp_card_name: r.pp_card_name,
  tcg_card_id: r.tcg_card_id,
  tcg_printing_key: r.tcg_printing_key,
  tcg_language: r.tcg_language,
}))
console.log(`     ${bulkSafeApproved.length} approved + bulk_safe + catalogue_corroborated`)

// Join: PP card details + commercial_rank for stratification
console.log('[2/5] enriching with PP + commercial_rank + provider details…')
const slugs = bulkSafeApproved.map(c => c.pp_card_slug)
const mappings = []
for (let i = 0; i < slugs.length; i += 50) {
  const { data } = await sb.from('pokemon_tcg_mappings')
    .select('id,pp_card_slug,commercial_rank,tcg_card_id,tcg_printing_key,tcg_language')
    .in('pp_card_slug', slugs.slice(i, i + 100))
  mappings.push(...(data || []))
}
const rankBySlug = new Map(mappings.map(m => [m.pp_card_slug, m.commercial_rank]))

const ppCards = []
for (let i = 0; i < slugs.length; i += 50) {
  const chunk = slugs.slice(i, i + 50)
  const { data, error } = await sb.from('cards')
    .select('card_slug,card_name,set_name,card_number,language,image_url,set_release_date,card_url_slug')
    .in('card_slug', chunk)
  if (error) console.log('     cards fetch error:', error.message)
  if (i === 0 && (data || []).length === 0) {
    console.log('     DEBUG: first chunk returned 0; sample slug:', chunk[0], 'typeof=', typeof chunk[0])
  }
  ppCards.push(...(data || []))
}
console.log(`     fetched ${ppCards.length} PP card rows for ${slugs.length} slugs`)
const ppBySlug = new Map(ppCards.map(c => [c.card_slug, c]))

// Fetch provider card details (image_normal + market feed presence)
const tcgIds = [...new Set(bulkSafeApproved.map(c => c.tcg_card_id))]
const providerCards = []
for (let i = 0; i < tcgIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,image_normal,tcg_set_name,tcg_collector_number')
    .in('tcg_card_id', tcgIds.slice(i, i + 100))
  providerCards.push(...(data || []))
}
const providerByKey = new Map(providerCards.map(p => [`${p.tcg_card_id}|${p.tcg_printing_key}`, p]))

// Market feed presence per (card_id, printing_key)
const marketKeys = new Set()
const marketLatest = new Map()        // key → latest source_updated_at
for (let i = 0; i < tcgIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_prices_market')
    .select('tcg_card_id,tcg_printing_key,source_updated_at')
    .in('tcg_card_id', tcgIds.slice(i, i + 100))
  for (const r of (data || [])) {
    const k = `${r.tcg_card_id}|${r.tcg_printing_key}`
    marketKeys.add(k)
    const prev = marketLatest.get(k)
    if (!prev || r.source_updated_at > prev) marketLatest.set(k, r.source_updated_at)
  }
}

// History availability per (card_id, printing_key)
const historyKeys = new Set()
for (let i = 0; i < tcgIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_prices_history')
    .select('tcg_card_id,tcg_printing_key')
    .in('tcg_card_id', tcgIds.slice(i, i + 100))
  for (const r of (data || [])) historyKeys.add(`${r.tcg_card_id}|${r.tcg_printing_key || 'ALL'}`)
}

// Graded data (PSA 10 specifically — a common signal of market interest)
const psa10Set = new Set()
for (let i = 0; i < tcgIds.length; i += 100) {
  const { data } = await sb.from('pokemon_tcg_prices_graded')
    .select('tcg_card_id').eq('grade', '10').in('tcg_card_id', tcgIds.slice(i, i + 100))
  for (const r of (data || [])) psa10Set.add(r.tcg_card_id)
}

console.log('[3/5] enriched; stratifying…')

function enrich(c) {
  const pp = ppBySlug.get(c.pp_card_slug)
  const prov = providerByKey.get(`${c.tcg_card_id}|${c.tcg_printing_key}`)
  const marketKey = `${c.tcg_card_id}|${c.tcg_printing_key}`
  return {
    mapping_id: c.mapping_id,
    pp_card_slug: c.pp_card_slug,
    pp_card_name: pp?.card_name,
    pp_set_name: pp?.set_name,
    pp_card_number: pp?.card_number,
    pp_language: pp?.language,
    pp_image_url: pp?.image_url,
    pp_url_slug: pp?.card_url_slug,
    pp_set_release_date: pp?.set_release_date,
    pp_psa10_usd: pp?.psa10_usd,
    pp_raw_usd: pp?.raw_usd,
    tcg_card_id: c.tcg_card_id,
    tcg_printing_key: c.tcg_printing_key,
    tcg_language: c.tcg_language,
    tcg_card_name: prov?.tcg_card_name,
    tcg_set_name: prov?.tcg_set_name,
    tcg_collector_number: prov?.tcg_collector_number,
    tcg_image_url: prov?.image_normal,
    market_source_updated_at: marketLatest.get(marketKey) || null,
    has_history: historyKeys.has(`${c.tcg_card_id}|${c.tcg_printing_key}`) || historyKeys.has(`${c.tcg_card_id}|ALL`),
    has_psa10: psa10Set.has(c.tcg_card_id),
    commercial_rank: rankBySlug.get(c.pp_card_slug) ?? null,
  }
}

const enriched = bulkSafeApproved.map(enrich).filter(r => r.tcg_image_url && marketKeys.has(`${r.tcg_card_id}|${r.tcg_printing_key}`))
console.log(`     ${enriched.length} candidates with image + market feed`)
const dLang = { en: 0, jp: 0, other: 0 }
const dPsa10 = { with: 0, without: 0 }
const dRelease = { modern_2023plus: 0, vintage_pre2004: 0, other: 0 }
for (const r of enriched) {
  if (r.pp_language === 'en') dLang.en++
  else if (r.pp_language === 'jp') dLang.jp++
  else dLang.other++
  if (r.has_psa10) dPsa10.with++; else dPsa10.without++
  const y = r.pp_set_release_date ? Number(r.pp_set_release_date.slice(0, 4)) : null
  if (y && y >= 2023) dRelease.modern_2023plus++
  else if (y && y <= 2003) dRelease.vintage_pre2004++
  else dRelease.other++
}
console.log('     distribution:', { lang: dLang, psa10: dPsa10, release: dRelease })

// Stratify cohorts
// Vintage = PP set_release_date year ≤ 2003
// Modern recent = PP set_release_date year ≥ 2023
function year(r) { return r.pp_set_release_date ? Number(r.pp_set_release_date.slice(0, 4)) : null }

function pickFirst(arr, n = 3) { return arr.slice(0, n) }
function sortByRank(arr) { return arr.sort((a, b) => (a.commercial_rank ?? 9999) - (b.commercial_rank ?? 9999)) }
function uniqOut(cohortArr, used) {
  return cohortArr.filter(r => !used.has(r.mapping_id))
}

const used = new Set()

const normalModern = pickFirst(sortByRank(enriched.filter(r =>
  r.pp_language === 'en' &&
  r.tcg_printing_key === 'normal' &&
  (year(r) ?? 0) >= 2023 &&
  r.has_psa10
)), 3)
normalModern.forEach(r => used.add(r.mapping_id))

const vintage = pickFirst(sortByRank(uniqOut(enriched.filter(r =>
  r.pp_language === 'en' &&
  (year(r) ?? 9999) <= 2003 &&
  r.has_psa10
), used)), 3)
vintage.forEach(r => used.add(r.mapping_id))

const foilModern = pickFirst(sortByRank(uniqOut(enriched.filter(r =>
  r.pp_language === 'en' &&
  r.tcg_printing_key === 'foil' &&
  (year(r) ?? 0) >= 2023 &&
  r.has_psa10
), used)), 3)
foilModern.forEach(r => used.add(r.mapping_id))

const marketOnly = pickFirst(sortByRank(uniqOut(enriched.filter(r =>
  r.pp_language === 'en' &&
  !r.has_psa10 &&
  r.market_source_updated_at
), used)), 3)
marketOnly.forEach(r => used.add(r.mapping_id))

const japanese = pickFirst(sortByRank(uniqOut(enriched.filter(r =>
  r.pp_language === 'jp' &&
  r.market_source_updated_at
), used)), 3)
japanese.forEach(r => used.add(r.mapping_id))

const withHistory = pickFirst(sortByRank(uniqOut(enriched.filter(r =>
  r.pp_language === 'en' &&
  r.has_history &&
  r.commercial_rank && r.commercial_rank <= 500
), used)), 3)
withHistory.forEach(r => used.add(r.mapping_id))

const cohort = {
  'Modern normal (EN, PSA 10 data)': normalModern,
  'Modern foil (EN, PSA 10 data)': foilModern,
  'Vintage (EN pre-2004 with PSA 10 data)': vintage,
  'Exact-printing market only (no PSA 10)': marketOnly,
  'Japanese (market only; no graded by invariant)': japanese,
  'With historical data (top-500 GSC)': withHistory,
}

console.log('[4/5] writing pilot cohort markdown…')
let md = `# PP-TCG-CUTOVER-PREP-01 Pilot Cohort\n\n`
md += `Generated ${new Date().toISOString()}. Each card is approved identity, bulk_safe eligibility (catalogue_corroborated risk), has a validated image AND an active market feed.\n\n`
md += `**None are activated.** Pilot cohort rows will be inserted with ALL features (prices/images/history) = FALSE. Each must be explicitly enabled per feature before an env flag triggers display.\n\n`

const flatCohort = []
let totalCount = 0
for (const [name, rows] of Object.entries(cohort)) {
  totalCount += rows.length
  md += `## ${name}\n\n`
  if (rows.length === 0) { md += `_(no eligible candidates)_\n\n`; continue }
  md += `| # | PokePrices | TCG card_id | Printing | Image source | PSA 10 | Market feed | History | Preview |\n`
  md += `|---|---|---|---|---|---|---|---|---|\n`
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ppUrl = `https://www.pokeprices.io/set/${encodeURIComponent(r.pp_set_name || '')}/card/${encodeURIComponent(r.pp_url_slug || '')}`
    const previewUrl = `https://www.pokeprices.io/admin/tcg-preview/${encodeURIComponent(r.pp_card_slug)}/full`
    const marketFresh = r.market_source_updated_at ? `✓ ${r.market_source_updated_at.slice(0, 10)}` : '—'
    const psa10 = r.has_psa10 ? '✓' : '—'
    const hist = r.has_history ? '✓' : '—'
    md += `| ${i + 1} | [${r.pp_card_name}](${ppUrl}) | \`${r.tcg_card_id}\` | \`${r.tcg_printing_key}\` | TCGGraph | ${psa10} | ${marketFresh} | ${hist} | [preview ↗](${previewUrl}) |\n`
    flatCohort.push(r)
  }
  md += `\n`
}

md += `## Totals\n\n`
md += `- **${flatCohort.length}** pilot cards total\n`
md += `- All have approved identity mapping (review_status='approved')\n`
md += `- All have validated bulk_safe eligibility\n`
md += `- All have at least one market feed and a TCG image\n`
md += `- No activation yet — operator must flip \`prices_enabled\` / \`images_enabled\` / \`history_enabled\` per slug before even one card serves TCGGraph data\n`

md += `\n## Activation + rollback procedures\n\n`
md += `### Activate images for one card (safest first step):\n`
md += `\`\`\`sql\n`
md += `UPDATE pokemon_tcg_pilot_cohort SET images_enabled=true, activated_at=now()\n`
md += `WHERE pp_card_slug = '<slug>';\n`
md += `\`\`\`\n`
md += `Then (in Vercel prod env): \`PP_USE_TCGGRAPH_IMAGES=1\`. Only that one card will see provider images.\n\n`
md += `### Activate prices for the same card:\n`
md += `\`\`\`sql\n`
md += `UPDATE pokemon_tcg_pilot_cohort SET prices_enabled=true WHERE pp_card_slug='<slug>';\n`
md += `\`\`\`\n`
md += `Then \`PP_USE_TCGGRAPH_PRICES=1\`.\n\n`
md += `### Rollback (any step):\n`
md += `\`\`\`sql\n`
md += `UPDATE pokemon_tcg_pilot_cohort SET deactivated_at=now()\n`
md += `WHERE pp_card_slug='<slug>';\n`
md += `\`\`\`\n`
md += `OR unset the env flag in Vercel.\n`

writeFileSync('scripts/_pp-tcg-cutover/pilot-cohort.md', md)
writeFileSync('scripts/_pp-tcg-cutover/pilot-cohort.json', JSON.stringify(cohort, null, 2))

console.log(`     wrote ${flatCohort.length} pilot cards to scripts/_pp-tcg-cutover/pilot-cohort.md`)

if (INSERT) {
  console.log('\n[5/5] inserting pilot cohort rows (all features=false)…')
  const rows = flatCohort.map(c => ({
    pp_card_slug: c.pp_card_slug,
    prices_enabled: false,
    images_enabled: false,
    history_enabled: false,
    notes: `pilot cohort proposal · tcg_card_id=${c.tcg_card_id} printing=${c.tcg_printing_key}`,
  }))
  const { error } = await sb.from('pokemon_tcg_pilot_cohort').upsert(rows, { onConflict: 'pp_card_slug' })
  if (error) throw new Error(`insert: ${error.message}`)
  console.log(`     ${rows.length} rows upserted (all features=false)`)
} else {
  console.log('\n[dry-run] no inserts. Re-run with --insert to populate pokemon_tcg_pilot_cohort.')
}
