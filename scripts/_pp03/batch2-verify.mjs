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
function moneyMatches(expectedDollars, body, currency = 'USD') {
  if (expectedDollars == null) return 'n/a'
  const sym = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : currency
  const n = Number(expectedDollars)
  const plain = `${sym}${fmt2(n)}`
  const comma = `${sym}${n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2})}`
  return body.includes(plain) || body.includes(comma) ? '✓' : '✗'
}

const BATCH2 = [
  { slug:'12368493', urlSlug:'meowth-ex-107', setName:'Perfect Order', name:'Meowth ex' },
  { slug:'13025625', urlSlug:'froakie-88', setName:'Chaos Rising', name:'Froakie' },
  { slug:'11830160', urlSlug:'canari-291', setName:'Ascended Heroes', name:'Canari' },
  { slug:'13025579', urlSlug:'mega-greninja-ex-122', setName:'Chaos Rising', name:'Mega Greninja ex' },
  { slug:'11197498', urlSlug:'mega-charizard-x-ex-23', setName:'Promo', name:'Mega Charizard X EX' },
]

const B1 = ['12368556','889380','3449535']
const SINISTEA = '5732721'
const BATCH3 = ['5732710','6770012','849472','7445267','5952701']
const THIN = ['2677929','3468740','6903541','6903528']
const results = { batch2: [], batch1Sinistea: [], batch3Thin: [], nonPilot: [] }

async function fetchCard(slug) {
  const { data: card } = await sb.from('cards').select('card_slug,card_name,set_name,card_url_slug,language,image_url').eq('card_slug', slug).maybeSingle()
  return card
}

async function checkProviderActive(slug) {
  const card = await fetchCard(slug)
  if (!card) return { slug, error: 'card not found' }
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  const r = await get(url)
  return {
    slug,
    card_name: card.card_name,
    marketplace: /Marketplace Snapshots/.test(r.body),
    psa9_in_faq: /PSA\s*9:/.test(r.body.match(/currently reads([^"]{0,200})/)?.[1] || ''),
    tcggraph_phrase: /TCGGraph.{0,10}realised-sale aggregation/.test(r.body),
    cache: r.headers['x-vercel-cache'],
    age: r.headers['age'],
  }
}

for (const c of BATCH2) {
  const card = await fetchCard(c.slug)
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||c.slug)}`

  const { data: m } = await sb.from('pokemon_tcg_mappings').select('*').eq('pp_card_slug',c.slug).eq('provider','tcggraph').maybeSingle()
  const { data: pc } = await sb.from('pokemon_tcg_provider_cards').select('*').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key).eq('provider_status','active').maybeSingle()
  const { data: market } = await sb.from('pokemon_tcg_prices_market').select('source,finish,list_type,currency,market,low').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key)
  const { data: graded } = await sb.from('pokemon_tcg_prices_graded').select('grader,grade,price,currency').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id)
  const perGrader = graded.filter(g => ['psa','bgs','cgc','sgc','raw'].includes(g.grader))

  const r = await get(url)
  const body = r.body
  const title = body.match(/<title>([^<]+)<\/title>/)?.[1]
  const desc = body.match(/<meta name="description" content="([^"]+)"/)?.[1]
  const canon = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  const ogurl = body.match(/property="og:url" content="([^"]+)"/)?.[1]
  const robots = body.match(/<meta name="robots"[^>]*>/)?.[0]
  const ldblocks = (body.match(/<script[^>]*type="application\/ld\+json"[^>]*>/g)||[]).length
  const bcCount = (body.match(/"@type":"ListItem"/g)||[]).length

  // Market checks
  const marketChecks = market.filter(x=>x.list_type==='retail').map(row => {
    const m = moneyMatches(row.market, body, row.currency)
    const l = moneyMatches(row.low, body, row.currency)
    return { source: row.source, currency: row.currency, market_val: row.market, market_match: m, low_val: row.low, low_match: l }
  })

  // Graded checks (per-grader)
  const gradedChecks = perGrader.filter(g=>g.price!=null).map(g => ({
    grader: g.grader, grade: g.grade, price: g.price, match: moneyMatches(g.price, body, g.currency),
  }))

  // Metadata: title should contain TCGGraph PSA10 token
  const tcgPsa10 = perGrader.find(g=>g.grader==='psa'&&g.grade==='10')?.price
  const tcgRaw = perGrader.find(g=>g.grader==='raw'&&g.grade==='ungraded')?.price
  const psa10Token = tcgPsa10 != null ? fmtSeoCents(Math.round(tcgPsa10*100)) : null
  const rawToken   = tcgRaw != null ? fmtSeoCents(Math.round(tcgRaw*100)) : null
  const titleHasPsa10 = psa10Token && title?.includes(psa10Token)
  const titleHasRaw   = rawToken && title?.includes(rawToken)

  // Pooled any:* leakage into PSA 10/9 labels
  const anyLeak = /any:/i.test(body)
  const psa9InDesc = /PSA 9/.test(desc||'')
  const neverAsking = (body.match(/never asking prices/g)||[]).length
  const askingNever = (body.match(/Asking prices are never used/g)||[]).length

  // Image: PP legacy present + no tcggraph image leak
  const imgLegacyPresent = card.image_url && body.includes(String(card.image_url).slice(0,60))
  const tcggraphImg = (body.match(/cards\.tcggraph/g)||[]).length

  results.batch2.push({
    slug: c.slug, card_name: card.card_name, set: card.set_name, lang: card.language,
    tcg_identity: `${m.tcg_card_id} | ${m.tcg_printing_key} | ${m.tcg_language}`,
    provider_card_active: !!pc, provider_card_name: pc?.tcg_card_name, provider_set_name: pc?.tcg_set_name, provider_number: pc?.tcg_collector_number,
    cache: r.headers['x-vercel-cache'], age: r.headers['age'],
    url,
    market: marketChecks,
    graded: gradedChecks,
    title, desc,
    title_uses_tcg_psa10: titleHasPsa10, title_uses_tcg_raw: titleHasRaw,
    psa9_in_desc: psa9InDesc, any_pooled_leak: anyLeak,
    legacy_wording_never_asking: neverAsking, legacy_wording_asking_never: askingNever,
    canon, ogurl, canon_eq_url_eq_ogurl: canon === url && ogurl === url,
    robots: robots || '(default index,follow)',
    ldblocks, bc_count: bcCount,
    img_legacy_present: imgLegacyPresent, tcggraph_img_leak: tcggraphImg,
  })
}

for (const slug of [...B1, SINISTEA]) results.batch1Sinistea.push(await checkProviderActive(slug))
for (const slug of BATCH3) results.batch3Thin.push({ ...(await checkProviderActive(slug)), group: 'B3' })
for (const slug of THIN)    results.batch3Thin.push({ ...(await checkProviderActive(slug)), group: 'thin' })
// Non-pilot sample
for (const slug of ['889091','888127']) {
  const { data: c } = await sb.from('cards').select('set_name,card_url_slug').eq('card_slug',slug).maybeSingle()
  if (!c) continue
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(c.set_name)}/card/${encodeURIComponent(c.card_url_slug||slug)}`
  const r = await get(url)
  results.nonPilot.push({
    slug, marketplace: /Marketplace Snapshots/.test(r.body),
    psa9_in_faq: /PSA\s*9:/.test(r.body.match(/currently reads([^"]{0,200})/)?.[1] || ''),
    tcggraph_phrase: /TCGGraph.{0,10}realised-sale aggregation/.test(r.body),
  })
}

// Also cohort states for Batch 3 + thin
const slugsOff = [...BATCH3, ...THIN]
const { data: cohortRows } = await sb.from('pokemon_tcg_pilot_cohort').select('pp_card_slug,prices_enabled,images_enabled,history_enabled').in('pp_card_slug', slugsOff)

// Print results
console.log('============================================================')
console.log('BATCH 2 PER-CARD CHECKS')
console.log('============================================================')
for (const r of results.batch2) {
  console.log(`\n--- ${r.slug}  ${r.card_name}  /  ${r.set}  /  lang=${r.lang} ---`)
  console.log(`  TCG id         : ${r.tcg_identity}`)
  console.log(`  provider card  : active=${r.provider_card_active}  name=${r.provider_card_name}  set=${r.provider_set_name}  #${r.provider_number}`)
  console.log(`  identity match : ${r.provider_card_active && r.card_name.startsWith(r.provider_card_name?.split(' ')[0]||'') ? '✓' : 'see values'}`)
  console.log(`  fetch cache=${r.cache} age=${r.age}`)
  console.log(`  Market (per source, native):`)
  for (const m of r.market) console.log(`    ${m.source.padEnd(10)} ${m.currency} market=${m.market_val} ${m.market_match} | low=${m.low_val} ${m.low_match}`)
  console.log(`  Graded (per-grader only):`)
  for (const g of r.graded) console.log(`    ${g.grader.padEnd(5)} ${String(g.grade).padEnd(10)} $${g.price} ${g.match}`)
  console.log(`  Metadata:`)
  console.log(`    title            : ${r.title}`)
  console.log(`    title uses TCG   : psa10 ${r.title_uses_tcg_psa10 ? '✓' : '✗'} | raw ${r.title_uses_tcg_raw ? '✓' : '✗'}`)
  console.log(`    desc PSA 9 clause: ${r.psa9_in_desc ? '✗ UNEXPECTED (should be absent in provider mode)' : '✓ absent'}`)
  console.log(`    legacy "never asking prices" count: ${r.legacy_wording_never_asking} (expect 0)`)
  console.log(`    legacy "Asking prices are never used" count: ${r.legacy_wording_asking_never} (expect 0)`)
  console.log(`    "any:*" pooled label leak: ${r.any_pooled_leak ? '✗ LEAK' : '✓ none'}`)
  console.log(`  SEO:`)
  console.log(`    canon==og:url==fetch: ${r.canon_eq_url_eq_ogurl ? '✓' : '✗'}`)
  console.log(`    robots: ${r.robots}`)
  console.log(`    ld+json blocks: ${r.ldblocks}  |  breadcrumb items: ${r.bc_count}`)
  console.log(`  Image preservation:`)
  console.log(`    PP image_url present : ${r.img_legacy_present ? '✓' : '✗'}`)
  console.log(`    cards.tcggraph leak  : ${r.tcggraph_img_leak === 0 ? '✓ none' : '✗ ' + r.tcggraph_img_leak}`)
}

console.log('\n============================================================')
console.log('BATCH 1 + SINISTEA — must remain provider-active')
console.log('============================================================')
for (const r of results.batch1Sinistea) {
  const active = r.marketplace && !r.psa9_in_faq
  console.log(`  ${r.slug.padEnd(10)} ${(r.card_name||'?').padEnd(28)} marketplace=${r.marketplace} psa9_in_faq=${r.psa9_in_faq} tcggraph_phrase=${r.tcggraph_phrase} ${active?'✓ active':'✗'}`)
}

console.log('\n============================================================')
console.log('BATCH 3 + thin-data — must remain legacy (not activated)')
console.log('============================================================')
const cohortMap = new Map((cohortRows||[]).map(c=>[c.pp_card_slug,c]))
for (const r of results.batch3Thin) {
  const legacy = !r.marketplace
  const cohort = cohortMap.get(r.slug)
  console.log(`  [${r.group}] ${r.slug.padEnd(10)} ${(r.card_name||'?').padEnd(28)} marketplace=${r.marketplace} ${legacy?'✓ legacy':'✗ ACTIVE?!'}  cohort.prices_enabled=${cohort?.prices_enabled}`)
}

console.log('\n============================================================')
console.log('Non-pilot sample — must remain legacy')
console.log('============================================================')
for (const r of results.nonPilot) {
  const legacy = !r.marketplace
  console.log(`  ${r.slug.padEnd(10)} marketplace=${r.marketplace} psa9_in_faq=${r.psa9_in_faq} ${legacy?'✓ legacy':'✗'}`)
}
