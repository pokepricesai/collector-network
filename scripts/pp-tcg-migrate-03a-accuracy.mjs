// PP-TCG-MIGRATE-03A §3: pricing-accuracy proof. For each cohort
// pick one real slug and print the full identity + price trail so
// the operator can verify each sample.

import './_lib/load-env.mjs'
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const hubRequire = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = hubRequire('@supabase/supabase-js')

const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } })

mkdirSync('scripts/_pp-tcg-migrate-03a', { recursive: true })

const COHORTS = [
  { label: 'English normal (modern, bulk_safe)', filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').ilike('pp_set_name', '%Scarlet%').limit(1) },
  { label: 'Vintage normal (bulk_safe, WOTC)',   filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'en').in('pp_set_name', ['Base Set 2','Jungle','Fossil','Neo Genesis']).limit(1) },
  { label: '1st Edition (market_only)',          filter: q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[1st Edition]%').limit(1) },
  { label: 'Shadowless (market_only)',           filter: q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Shadowless]%').limit(1) },
  { label: 'Reverse Holo (market_only)',         filter: q => q.eq('pricing_eligibility', 'market_only').ilike('pp_card_name', '%[Reverse Holo]%').limit(1) },
  { label: 'Japanese (bulk_safe, no graded)',    filter: q => q.eq('pricing_eligibility', 'bulk_safe').eq('pp_language', 'jp').limit(1) },
  { label: 'Promo (identity verified)',          filter: q => q.ilike('pp_set_name', '%Promo%').eq('confidence', 'verified').limit(1) },
  { label: 'Unsupported variant (identity_only)', filter: q => q.eq('pricing_eligibility', 'identity_only').ilike('pp_card_name', '%[Mirror Holo]%').limit(1) },
  { label: 'No TCG equivalent (Topps)',          filter: q => q.eq('review_status', 'no_tcg_equivalent').limit(1) },
  { label: 'High-traffic (GSC rank)',            filter: q => q.not('commercial_rank', 'is', null).order('commercial_rank', { ascending: true }).limit(1) },
]

const findings = []
for (const c of COHORTS) {
  let q = sb.from('pokemon_tcg_mappings')
    .select('pp_card_slug, pp_card_name, pp_set_name, pp_language, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_name, confidence, review_status, pricing_eligibility, commercial_rank')
    .eq('provider', 'tcggraph')
  q = c.filter(q)
  const { data } = await q
  if (!data || data.length === 0) {
    findings.push({ cohort: c.label, status: 'NO MATCH' })
    continue
  }
  const m = data[0]
  const [cardRes, marketRes, gradedRes, trendRes] = await Promise.all([
    sb.from('pokemon_tcg_provider_cards').select('image_normal, image_source').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key).maybeSingle(),
    sb.from('pokemon_tcg_prices_market').select('source, finish, list_type, currency, market').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key),
    sb.from('pokemon_tcg_prices_graded').select('grader, grade, currency, price').eq('tcg_card_id', m.tcg_card_id).order('grade'),
    sb.from('card_trends').select('current_raw, current_psa10, current_psa9, as_of').eq('card_slug', m.pp_card_slug).maybeSingle(),
  ])
  findings.push({
    cohort: c.label,
    pp: {
      slug: m.pp_card_slug,
      name: m.pp_card_name,
      set: m.pp_set_name,
      language: m.pp_language,
      commercial_rank: m.commercial_rank,
    },
    tcg: {
      card_id: m.tcg_card_id,
      printing_key: m.tcg_printing_key,
      set_code: m.tcg_set_code,
      name: m.tcg_name,
      confidence: m.confidence,
      pricing_eligibility: m.pricing_eligibility,
      review_status: m.review_status,
    },
    provider_image: cardRes.data?.image_normal ?? null,
    provider_image_source: cardRes.data?.image_source ?? null,
    market_rows: marketRes.data ?? [],
    graded_rows: gradedRes.data ?? [],
    legacy_card_trends: trendRes.data ?? null,
    preview_url: `https://www.pokeprices.io/admin/tcg-preview/${encodeURIComponent(m.pp_card_slug)}/full`,
  })
}

writeFileSync('scripts/_pp-tcg-migrate-03a/accuracy.json', JSON.stringify(findings, null, 2))

for (const f of findings) {
  if (f.status === 'NO MATCH') { console.log(`\n[${f.cohort}] NO MATCH`); continue }
  console.log(`\n[${f.cohort}]`)
  console.log(`  PP slug=${f.pp.slug}  ${f.pp.name}  (set="${f.pp.set}", lang=${f.pp.language})`)
  console.log(`  TCG  ${f.tcg.card_id} / ${f.tcg.printing_key}  (${f.tcg.set_code})  name="${f.tcg.name}"  confidence=${f.tcg.confidence}  eligibility=${f.tcg.pricing_eligibility}`)
  console.log(`  provider_image=${f.provider_image ? 'YES' : 'NO'}  source=${f.provider_image_source ?? '—'}`)
  console.log(`  market rows: ${f.market_rows.length}`)
  for (const m of f.market_rows.slice(0, 4)) {
    console.log(`    - ${m.source.padEnd(12)} finish=${(m.finish||'—').padEnd(16)} ${m.list_type}  ${m.currency}  market=${m.market ?? '—'}`)
  }
  console.log(`  graded rows: ${f.graded_rows.length}`)
  for (const g of f.graded_rows.slice(0, 6)) {
    console.log(`    - ${g.grader.padEnd(6)} grade=${(g.grade||'—').padEnd(4)}  ${g.currency}  price=${g.price ?? '—'}`)
  }
  if (f.legacy_card_trends) {
    const t = f.legacy_card_trends
    console.log(`  legacy card_trends: raw=$${(t.current_raw||0)/100} psa10=$${(t.current_psa10||0)/100} psa9=$${(t.current_psa9||0)/100} as_of=${t.as_of}`)
  }
  console.log(`  preview: ${f.preview_url}`)
}

console.log('\n[done] see scripts/_pp-tcg-migrate-03a/accuracy.json')
