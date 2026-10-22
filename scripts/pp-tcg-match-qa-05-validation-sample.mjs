// PP-TCG-MATCH §8 — independent validation sample.
//
// Pulls 5 cards each across 5 cohorts (normal, foil, vintage,
// Japanese, high-traffic) from catalogue_corroborated mappings
// whose recommended_eligibility = current pricing_eligibility
// (i.e. the pure clean cohort). Writes a Markdown report with
// one row per card including the public pokeprices.io URL and
// a pokemontcg.io search URL for operator-side independent
// cross-check.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-match-qa', { recursive: true })

async function fetchAll(table, select, filters = (q) => q) {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await filters(sb.from(table).select(select)).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return out
}

console.log('[1/4] pulling catalogue_corroborated identity-safe rows…')
const qa = await fetchAll(
  'pokemon_tcg_mapping_qa',
  'mapping_id,pp_card_slug,tcg_card_id,tcg_printing_key,risk_class,prior_pricing_eligibility,recommended_pricing_eligibility,single_printing',
  q => q.eq('risk_class', 'catalogue_corroborated'),
)
console.log(`     ${qa.length} catalogue_corroborated rows`)

const slugs = qa.map(r => r.pp_card_slug)

console.log('[2/4] joining PP card metadata (chunked IN clauses)…')
const ppCards = []
for (let i = 0; i < slugs.length; i += 500) {
  const chunk = slugs.slice(i, i + 500)
  const { data, error } = await sb.from('cards')
    .select('card_slug,card_name,set_name,card_number,language,image_url,set_release_date')
    .in('card_slug', chunk)
  if (error) throw new Error(`cards chunk: ${error.message}`)
  ppCards.push(...(data || []))
}
const ppBySlug = new Map(ppCards.map(c => [c.card_slug, c]))

console.log('[3/4] joining TCG provider card…')
const tcgIds = [...new Set(qa.map(r => r.tcg_card_id).filter(Boolean))]
const providerCards = []
const BATCH = 300
for (let i = 0; i < tcgIds.length; i += BATCH) {
  const chunk = tcgIds.slice(i, i + BATCH)
  const { data } = await sb.from('pokemon_tcg_provider_cards')
    .select('tcg_card_id,tcg_printing_key,tcg_set_code,tcg_set_name,tcg_card_name,tcg_collector_number,image_normal,raw_payload')
    .in('tcg_card_id', chunk)
  providerCards.push(...(data || []))
}
const tcgByKey = new Map(providerCards.map(p => [`${p.tcg_card_id}|${p.tcg_printing_key}`, p]))

console.log('[4/4] stratifying cohorts…')

const augmented = qa.map(r => {
  const pp = ppBySlug.get(r.pp_card_slug)
  const tcg = r.tcg_card_id && r.tcg_printing_key ? tcgByKey.get(`${r.tcg_card_id}|${r.tcg_printing_key}`) : null
  return { ...r, pp, tcg }
}).filter(r => r.pp && r.tcg)

function sample(cohort, n = 5) {
  // Deterministic sample: sort by pp_card_slug and take first n
  return cohort.sort((a, b) => a.pp_card_slug.localeCompare(b.pp_card_slug)).slice(0, n)
}

const normal = sample(augmented.filter(r =>
  r.pp.language === 'en' &&
  r.tcg_printing_key === 'normal' &&
  r.single_printing &&
  r.pp.set_release_date && Number(r.pp.set_release_date.slice(0, 4)) >= 2023 &&
  !/\[.*?\]/.test(r.pp.card_name)
))

const foil = sample(augmented.filter(r =>
  r.pp.language === 'en' &&
  r.tcg_printing_key === 'foil' &&
  r.single_printing &&
  r.pp.set_release_date && Number(r.pp.set_release_date.slice(0, 4)) >= 2023 &&
  !/\[.*?\]/.test(r.pp.card_name)
))

const VINTAGE_SETS = /^(Base Set|Jungle|Fossil|Team Rocket|Gym Heroes|Gym Challenge|Neo Genesis|Neo Discovery|Neo Destiny|Neo Revelation|Expedition|Aquapolis|Skyridge)$/i
const vintage = sample(augmented.filter(r =>
  r.pp.language === 'en' &&
  VINTAGE_SETS.test(r.pp.set_name || '')
))

const japanese = sample(augmented.filter(r =>
  r.pp.language === 'jp'
))

// High-traffic requires commercial_rank — pull from mappings (chunked IN clauses)
const mappings = []
for (let i = 0; i < slugs.length; i += 500) {
  const chunk = slugs.slice(i, i + 500)
  const { data } = await sb.from('pokemon_tcg_mappings')
    .select('id,pp_card_slug,commercial_rank')
    .in('pp_card_slug', chunk)
    .not('commercial_rank', 'is', null)
  mappings.push(...(data || []))
}
const rankBySlug = new Map(mappings.map(m => [m.pp_card_slug, m.commercial_rank]))
const highTraffic = sample(
  augmented
    .map(r => ({ ...r, rank: rankBySlug.get(r.pp_card_slug) ?? 999999 }))
    .filter(r => Number.isFinite(r.rank) && r.rank <= 500)
    .sort((a, b) => a.rank - b.rank),
  5,
)

const cohorts = {
  'Normal (modern EN, no variant tag)': normal,
  'Foil (modern EN, single-printing cards)': foil,
  'Vintage (EN pre-2004)': vintage,
  'Japanese': japanese,
  'High-traffic (GSC top-500)': highTraffic,
}

// Markdown report
let md = `# PP-TCG-MATCH independent validation sample\n\n`
md += `Generated ${new Date().toISOString()}. All samples drawn from the catalogue_corroborated QA cohort where recommended_eligibility = prior pricing_eligibility (the pure "ready to approve" set).\n\n`
md += `**For each row the operator should cross-check** the card identity at **pokemontcg.io** or **Bulbapedia** — NOT TCGGraph — and confirm:\n`
md += `1. Name matches\n2. Collector number matches\n3. Set matches\n4. Printing (holo/foil/reverse-holo) matches\n5. Image on the external source looks like the image shown here\n\n`

for (const [name, rows] of Object.entries(cohorts)) {
  md += `## ${name}\n\n`
  if (rows.length === 0) { md += `_(no samples found)_\n\n`; continue }
  md += `| # | PokePrices | Set / Number | Lang | TCG printing | Siblings | Independent check |\n`
  md += `|---|---|---|---|---|---|---|\n`
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const siblings = r.tcg?.tcg_card_id ? providerCards.filter(p => p.tcg_card_id === r.tcg.tcg_card_id).map(p => p.tcg_printing_key).join(', ') : '—'
    const ptcgQuery = encodeURIComponent(`${r.tcg?.tcg_card_name ?? ''} ${r.tcg?.tcg_set_code ?? ''}`)
    const ptcgUrl = `https://pokemontcg.io/sets/${r.tcg?.tcg_set_code}` // operator can scroll to the right card
    const ppUrl = `https://www.pokeprices.io/card/${r.pp_card_slug}`
    md += `| ${i + 1} | [${r.pp.card_name}](${ppUrl}) | ${r.pp.set_name} / ${r.pp.card_number} | ${r.pp.language} | \`${r.tcg_printing_key}\` | ${siblings} | [${r.tcg?.tcg_set_code} on pokemontcg.io](${ptcgUrl}) |\n`
  }
  md += `\n`
}

md += `## How to use this sample\n\n`
md += `1. Open each PokePrices URL in one tab, each pokemontcg.io URL in another.\n`
md += `2. Confirm the card identity matches (name, number, set, printing).\n`
md += `3. If every row of all 5 cohorts validates clean → proceed with the identity-safe bulk approval.\n`
md += `4. If any row fails → open a ticket to investigate the mis-match class before approving the cohort it belongs to.\n`

writeFileSync('scripts/_pp-tcg-match-qa/validation-sample.md', md)
writeFileSync('scripts/_pp-tcg-match-qa/validation-sample.json', JSON.stringify(cohorts, null, 2))

console.log('\n  Report written to scripts/_pp-tcg-match-qa/validation-sample.md')
for (const [name, rows] of Object.entries(cohorts)) {
  console.log(`    ${name.padEnd(42)} ${rows.length} cards`)
}

console.log('\n[done]')
