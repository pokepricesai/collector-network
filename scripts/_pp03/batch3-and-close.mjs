import '../_lib/load-env.mjs'
import https from 'node:https'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
function get(u) { return new Promise((res,rej)=>{ https.get(u,{headers:{'Cache-Control':'no-cache'}}, r=>{let b=''; r.on('data',c=>b+=c); r.on('end',()=>res({headers:r.headers, body:b}))}).on('error',rej) }) }
function fmt2(n) { return Number(n).toFixed(2) }
function fmtSeoCents(cents) { if (cents == null) return null; const v = cents / 100; return v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}` }
function moneyMatches(expectedDollars, body, currency='USD') {
  if (expectedDollars == null) return 'n/a'
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency
  const n = Number(expectedDollars)
  const plain = `${sym}${fmt2(n)}`
  const comma = `${sym}${n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`
  return body.includes(plain) || body.includes(comma) ? '✓' : '✗'
}

const BATCH3 = ['5732710','6770012','849472','7445267','5952701']
const ALL_ACTIVE = ['5732721','12368556','889380','3449535','12368493','13025625','11830160','13025579','11197498', ...BATCH3]
const THIN = ['2677929','3468740','6903541','6903528']
const NON_PILOT_SAMPLE = ['889091','888127','1099508']

const summary = { batch3: [], all14: [], thin: [], non_pilot: [] }

for (const slug of BATCH3) {
  const { data: card } = await sb.from('cards').select('card_slug,card_name,set_name,card_url_slug,language,image_url').eq('card_slug', slug).maybeSingle()
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  const { data: m } = await sb.from('pokemon_tcg_mappings').select('*').eq('pp_card_slug',slug).eq('provider','tcggraph').maybeSingle()
  const { data: pc } = await sb.from('pokemon_tcg_provider_cards').select('*').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key).eq('provider_status','active').maybeSingle()
  const { data: market } = await sb.from('pokemon_tcg_prices_market').select('source,finish,list_type,currency,market,low').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key)
  const { data: graded } = await sb.from('pokemon_tcg_prices_graded').select('grader,grade,price,currency').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id)
  const perGrader = graded.filter(g=>['psa','bgs','cgc','sgc','raw'].includes(g.grader))
  const { data: qa } = await sb.from('pokemon_tcg_mapping_qa').select('risk_class,recommended_pricing_eligibility,warnings').eq('mapping_id', m.id).maybeSingle()

  const r = await get(url)
  const body = r.body
  const title = body.match(/<title>([^<]+)<\/title>/)?.[1]
  const desc = body.match(/<meta name="description" content="([^"]+)"/)?.[1]
  const canon = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  const ogurl = body.match(/property="og:url" content="([^"]+)"/)?.[1]
  const robots = body.match(/<meta name="robots"[^>]*>/)?.[0]
  const ldblocks = (body.match(/<script[^>]*type="application\/ld\+json"[^>]*>/g)||[]).length
  const bcCount = (body.match(/"@type":"ListItem"/g)||[]).length

  const marketChecks = market.filter(x=>x.list_type==='retail').map(row => ({
    source: row.source, currency: row.currency, market_val: row.market, market_match: moneyMatches(row.market, body, row.currency), low_val: row.low, low_match: moneyMatches(row.low, body, row.currency),
  }))
  const gradedChecks = perGrader.filter(g=>g.price!=null).map(g => ({ grader:g.grader, grade:g.grade, price:g.price, match: moneyMatches(g.price, body, g.currency) }))
  const tcgPsa10 = perGrader.find(g=>g.grader==='psa'&&g.grade==='10')?.price
  const tcgRaw = perGrader.find(g=>g.grader==='raw'&&g.grade==='ungraded')?.price
  const psa10Token = tcgPsa10 != null ? fmtSeoCents(Math.round(tcgPsa10*100)) : null
  const rawToken = tcgRaw != null ? fmtSeoCents(Math.round(tcgRaw*100)) : null

  const isJapanese = card.language === 'jp' || m.tcg_language === 'ja' || /japanese/i.test(card.set_name)
  summary.batch3.push({
    slug, card: card.card_name, set: card.set_name, lang: card.language, is_japanese: isJapanese,
    tcg_identity: `${m.tcg_card_id} | ${m.tcg_printing_key} | ${m.tcg_language}`,
    provider_card: pc ? `${pc.tcg_card_name} / ${pc.tcg_set_name} / #${pc.tcg_collector_number}` : 'NONE',
    provider_active: !!pc,
    qa_risk: qa?.risk_class, qa_rec_elig: qa?.recommended_pricing_eligibility, qa_warnings: qa?.warnings,
    pricing_eligibility: m.pricing_eligibility,
    cache: r.headers['x-vercel-cache'], age: r.headers['age'],
    url,
    market: marketChecks,
    graded: gradedChecks,
    title, title_uses_psa10: !!(psa10Token && title?.includes(psa10Token)), title_uses_raw: !!(rawToken && title?.includes(rawToken)),
    canon_eq_url_eq_og: canon === url && ogurl === url,
    psa9_in_desc: /PSA 9/.test(desc||''),
    legacy_never_asking: (body.match(/never asking prices/g)||[]).length,
    legacy_asking_never: (body.match(/Asking prices are never used/g)||[]).length,
    tcggraph_phrase: (body.match(/TCGGraph.{0,10}realised-sale aggregation/g)||[]).length,
    any_pooled_leak: /any:/i.test(body),
    img_legacy_present: card.image_url && body.includes(String(card.image_url).slice(0,60)),
    tcggraph_img_leak: (body.match(/cards\.tcggraph/g)||[]).length,
    robots: robots || '(default index,follow)',
    ldblocks, bc_count: bcCount,
  })
}

// All 14 active
for (const slug of ALL_ACTIVE) {
  const { data: card } = await sb.from('cards').select('card_name,set_name,card_url_slug').eq('card_slug',slug).maybeSingle()
  if (!card) continue
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  const r = await get(url)
  summary.all14.push({ slug, card: card.card_name, marketplace: /Marketplace Snapshots/.test(r.body), psa9_in_faq: /PSA\s*9:/.test(r.body.match(/currently reads([^"]{0,200})/)?.[1] || ''), tcggraph: /TCGGraph.{0,10}realised-sale aggregation/.test(r.body) })
}

// 4 thin-data
for (const slug of THIN) {
  const { data: card } = await sb.from('cards').select('card_name,set_name,card_url_slug').eq('card_slug',slug).maybeSingle()
  if (!card) continue
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  const r = await get(url)
  const { data: coh } = await sb.from('pokemon_tcg_pilot_cohort').select('prices_enabled,images_enabled,history_enabled').eq('pp_card_slug',slug).maybeSingle()
  summary.thin.push({ slug, card: card.card_name, marketplace: /Marketplace Snapshots/.test(r.body), prices_enabled: coh?.prices_enabled, images_enabled: coh?.images_enabled, history_enabled: coh?.history_enabled })
}

// Non-pilot sample
for (const slug of NON_PILOT_SAMPLE) {
  const { data: card } = await sb.from('cards').select('card_name,set_name,card_url_slug').eq('card_slug',slug).maybeSingle()
  if (!card) continue
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  const r = await get(url)
  summary.non_pilot.push({ slug, card: card.card_name, marketplace: /Marketplace Snapshots/.test(r.body), psa9_in_faq: /PSA\s*9:/.test(r.body.match(/currently reads([^"]{0,200})/)?.[1] || '') })
}

// Print
console.log('=== BATCH 3 PER-CARD ===')
for (const r of summary.batch3) {
  console.log(`\n--- ${r.slug} ${r.card} / ${r.set} / lang=${r.lang}${r.is_japanese?' [JAPANESE]':''} ---`)
  console.log(`  TCG id/key/lang: ${r.tcg_identity}`)
  console.log(`  provider card  : ${r.provider_card} (active=${r.provider_active})`)
  console.log(`  QA             : risk=${r.qa_risk} rec_elig=${r.qa_rec_elig} warnings=${JSON.stringify(r.qa_warnings)}`)
  console.log(`  elig (matcher) : ${r.pricing_eligibility}`)
  console.log(`  cache=${r.cache} age=${r.age}`)
  console.log(`  Market (native):`)
  for (const m of r.market) console.log(`    ${m.source.padEnd(10)} ${m.currency} market=${m.market_val}${m.market_match} low=${m.low_val}${m.low_match}`)
  console.log(`  Graded (per-grader):`)
  for (const g of r.graded) console.log(`    ${g.grader.padEnd(5)} ${String(g.grade).padEnd(10)} $${g.price}${g.match}`)
  console.log(`  title: ${r.title}`)
  console.log(`  title uses TCG tokens: psa10=${r.title_uses_psa10} raw=${r.title_uses_raw}`)
  console.log(`  canonical==og:url==fetch: ${r.canon_eq_url_eq_og}`)
  console.log(`  psa9_in_desc: ${r.psa9_in_desc}  any_pooled_leak: ${r.any_pooled_leak}`)
  console.log(`  legacy never-asking phrases: ${r.legacy_never_asking}+${r.legacy_asking_never} (expect 0+0)`)
  console.log(`  tcggraph realised-sale phrase: ${r.tcggraph_phrase} (expect ≥1)`)
  console.log(`  image: legacy_present=${r.img_legacy_present} tcggraph_leak=${r.tcggraph_img_leak}`)
  console.log(`  robots: ${r.robots}  ld+json: ${r.ldblocks}  breadcrumbs: ${r.bc_count}`)
}

console.log('\n=== ALL 14 ACTIVATED (should all be provider-active) ===')
let activeOk = 0
for (const r of summary.all14) {
  const ok = r.marketplace && !r.psa9_in_faq && r.tcggraph
  if (ok) activeOk++
  console.log(`  ${r.slug.padEnd(10)} ${(r.card||'').padEnd(28)} mkt=${r.marketplace} psa9_faq=${r.psa9_in_faq} tcg_phrase=${r.tcggraph} ${ok?'✓':'✗'}`)
}
console.log(`  → ${activeOk}/${summary.all14.length} active`)

console.log('\n=== 4 THIN-DATA (should remain disabled) ===')
let disabledOk = 0
for (const r of summary.thin) {
  const ok = !r.marketplace && r.prices_enabled === false && r.images_enabled === false && r.history_enabled === false
  if (ok) disabledOk++
  console.log(`  ${r.slug.padEnd(10)} ${(r.card||'').padEnd(26)} mkt=${r.marketplace} cohort=p${r.prices_enabled}/i${r.images_enabled}/h${r.history_enabled} ${ok?'✓':'✗'}`)
}
console.log(`  → ${disabledOk}/${summary.thin.length} disabled`)

console.log('\n=== NON-PILOT SAMPLE (should remain legacy) ===')
let legacyOk = 0
for (const r of summary.non_pilot) {
  const ok = !r.marketplace && r.psa9_in_faq
  if (ok) legacyOk++
  console.log(`  ${r.slug.padEnd(10)} ${(r.card||'').padEnd(26)} mkt=${r.marketplace} psa9_faq=${r.psa9_in_faq} ${ok?'✓':'✗'}`)
}
console.log(`  → ${legacyOk}/${summary.non_pilot.length} legacy`)
