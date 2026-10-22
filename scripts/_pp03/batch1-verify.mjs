import '../_lib/load-env.mjs'
import https from 'node:https'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
const { createClient } = req('@supabase/supabase-js')
const sb = createClient('https://egidpsrkqvymvioidatc.supabase.co',process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}})
function get(u) { return new Promise((res,rej)=>{ https.get(u,{headers:{'Cache-Control':'no-cache'}}, r=>{let b=''; r.on('data',c=>b+=c); r.on('end',()=>res({status:r.statusCode, headers:r.headers, body:b}))}).on('error',rej) }) }
function fmt2(n) { return Number(n).toFixed(2) }
function escapeRe(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

const REPS = ['12368556', '889380', '3449535']

for (const slug of REPS) {
  console.log('\n============================================================')
  console.log('SLUG ' + slug)
  console.log('============================================================')

  const { data: card } = await sb.from('cards').select('card_slug,card_name,set_name,card_url_slug,language,image_url').eq('card_slug', slug).maybeSingle()
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(card.set_name)}/card/${encodeURIComponent(card.card_url_slug||slug)}`
  console.log(`card: ${card.card_name} | set: ${card.set_name} | lang: ${card.language}`)
  console.log(`url : ${url}`)

  const { data: m } = await sb.from('pokemon_tcg_mappings').select('*').eq('pp_card_slug',slug).eq('provider','tcggraph').maybeSingle()
  const { data: pc } = await sb.from('pokemon_tcg_provider_cards').select('*').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key).eq('provider_status','active').maybeSingle()
  console.log(`provider: card=${m.tcg_card_id} key=${m.tcg_printing_key} lang=${m.tcg_language} status=${pc?.provider_status}`)
  console.log(`provider card: ${pc?.tcg_card_name} / ${pc?.tcg_set_name} / #${pc?.tcg_collector_number}`)

  const { data: market } = await sb.from('pokemon_tcg_prices_market').select('source,finish,list_type,currency,market,low').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id).eq('tcg_printing_key', m.tcg_printing_key)
  console.log(`\nDB market rows:`)
  for (const r of market) console.log(`  ${r.source.padEnd(12)} ${r.list_type} ${r.currency} market=${r.market} low=${r.low}`)

  const { data: graded } = await sb.from('pokemon_tcg_prices_graded').select('grader,grade,currency,price').eq('provider','tcggraph').eq('tcg_card_id', m.tcg_card_id)
  const perGrader = graded.filter(g => ['psa','bgs','cgc','sgc','raw'].includes(g.grader))
  console.log(`\nDB graded rows (per-grader only):`)
  for (const g of perGrader) console.log(`  ${g.grader.padEnd(5)} ${String(g.grade).padEnd(10)} ${g.currency} $${g.price}`)

  // Fetch public
  const r = await get(url)
  const body = r.body
  console.log(`\npublic fetch: status=${r.status} cache=${r.headers['x-vercel-cache']} age=${r.headers['age']}`)

  // 1. Market values in HTML match DB
  console.log(`\n--- 1. market values in HTML match DB ---`)
  for (const row of market) {
    if (row.list_type !== 'retail') continue
    const sym = row.currency === 'USD' ? '$' : row.currency === 'EUR' ? '€' : row.currency
    const expMarket = row.market != null ? `${sym}${fmt2(row.market)}` : null
    const expLow    = row.low    != null ? `${sym}${fmt2(row.low)}`    : null
    const hasMarket = expMarket != null && body.includes(expMarket)
    const hasLow    = expLow    != null && body.includes(expLow)
    const marketOk = expMarket == null ? 'n/a' : (hasMarket ? '✓' : '✗')
    const lowOk    = expLow    == null ? 'n/a' : (hasLow    ? '✓' : '✗')
    console.log(`  ${row.source.padEnd(12)} ${row.currency}: market ${expMarket || '(null)'} ${marketOk} | low ${expLow || '(null)'} ${lowOk}`)
  }

  // 2. Graded values in HTML match DB
  console.log(`\n--- 2. graded values in HTML match DB (per-grader) ---`)
  for (const g of perGrader) {
    if (g.price == null) { console.log(`  ${g.grader}:${g.grade} = (null) n/a`); continue }
    const dollarStr = '$' + fmt2(g.price)
    const inHtml = body.includes(dollarStr)
    console.log(`  ${g.grader}:${g.grade} = ${dollarStr} ${inHtml ? '✓' : '✗'}`)
  }

  // 3. Japanese handling
  if (card.language === 'ja' || m.tcg_language === 'ja' || /japanese/i.test(card.set_name)) {
    console.log(`\n--- 3. Japanese language/printing ---`)
    console.log(`  pp language: ${card.language}`)
    console.log(`  tcg language: ${m.tcg_language}`)
    console.log(`  set has "Japanese" prefix: ${/japanese/i.test(card.set_name)}`)
    console.log(`  Cardmarket (EU) label present: ${/Cardmarket \(EU\)/.test(body)}`)
    console.log(`  TCGplayer (US) label present: ${/TCGplayer \(US\)/.test(body)}`)
    console.log(`  USD values ($x.xx) visible : ${/\$\d+\.\d{2}/.test(body)}`)
    console.log(`  EUR values (€x.xx) visible : ${/€\d+\.\d{2}/.test(body)}`)
    console.log(`  "no FX conversion applied" disclaimer: ${/no FX conversion applied/.test(body)}`)
  }

  // 4. Legacy claim absence
  console.log(`\n--- 4. legacy sold-sales claim absence (provider mode) ---`)
  console.log(`  "never asking prices" count: ${(body.match(/never asking prices/g)||[]).length} (expect 0)`)
  console.log(`  "Asking prices are never used" count: ${(body.match(/Asking prices are never used/g)||[]).length} (expect 0)`)
  console.log(`  TCGGraph realised-sale phrase count: ${(body.match(/TCGGraph.{0,5}realised-sale aggregation/g)||[]).length} (expect >= 1)`)

  // 5. SEO invariants
  const canon = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1]
  const ogurl = body.match(/property="og:url" content="([^"]+)"/)?.[1]
  const robots = body.match(/<meta name="robots"[^>]*>/)
  const title = body.match(/<title>([^<]+)<\/title>/)?.[1]
  const ldblocks = (body.match(/<script[^>]*type="application\/ld\+json"[^>]*>/g)||[]).length
  const ldTypes = [...new Set([...body.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m=>m[1]))]
  console.log(`\n--- 5. SEO ---`)
  console.log(`  title    : ${title}`)
  console.log(`  canonical: ${canon}`)
  console.log(`  og:url   : ${ogurl}`)
  console.log(`  canonical==og:url==fetch_url: ${canon===ogurl && canon===url}`)
  console.log(`  robots   : ${robots?.[0] || '(default index,follow)'}`)
  console.log(`  ld+json  : ${ldblocks} blocks | types: ${ldTypes.join(', ')}`)

  // 6. Image preservation
  const ppImgPrefix = String(card.image_url || '').slice(0, 60)
  const hasImageHero = ppImgPrefix && new RegExp(escapeRe(ppImgPrefix)).test(body)
  const tcggraphImgCount = (body.match(/cards\.tcggraph/g)||[]).length
  console.log(`\n--- 6. image preservation (image flag OFF) ---`)
  console.log(`  pp image_url prefix: ${ppImgPrefix}`)
  console.log(`  pp image present in HTML: ${hasImageHero ? '✓' : '(deeper check needed)'}`)
  console.log(`  TCGGraph image domain leak: ${tcggraphImgCount === 0 ? '✓ none' : '✗ ' + tcggraphImgCount}`)

  // 7. Internal links / breadcrumbs
  const bcItems = [...body.matchAll(/"@type":"ListItem"[^}]*?"name":"([^"]+)"[^}]*?"item":"([^"]+)"/g)].map(m=>({name:m[1], item:m[2]}))
  console.log(`\n--- 7. breadcrumb ---`)
  for (const b of bcItems) console.log(`  ${b.name} → ${b.item}`)
}

// 8. Isolation: 2 pilot-off + 2 non-pilot
console.log('\n============================================================')
console.log('ISOLATION — pilot-off + non-pilot cards still legacy')
console.log('============================================================')
const otherChecks = [
  ['pilot-off', '5732710'],  // Banette
  ['pilot-off', '12368493'], // Meowth ex (will be in batch 2)
  ['non-pilot', '889091'],
  ['non-pilot', '888127'],
]
for (const [kind, slug] of otherChecks) {
  const { data: c } = await sb.from('cards').select('set_name,card_url_slug').eq('card_slug',slug).maybeSingle()
  if (!c) continue
  const url = `https://www.pokeprices.io/set/${encodeURIComponent(c.set_name)}/card/${encodeURIComponent(c.card_url_slug||slug)}`
  const r = await get(url)
  const marketplace = /Marketplace Snapshots/.test(r.body)
  const faq = r.body.match(/currently reads([^"]{0,120})/)?.[1] || ''
  const psa9InFaq = /PSA\s*9:/i.test(faq)
  const providerActive = marketplace || !psa9InFaq && faq.length>0
  console.log(`${kind.padEnd(10)} ${slug.padEnd(10)} marketplace_panel=${marketplace} psa9_in_faq=${psa9InFaq} provider_active_signal=${providerActive} ${providerActive?'✗ LEAK':'✓ legacy'}`)
}

// Sinistea should still be active
console.log('\n--- Sinistea (prior pilot, must remain ACTIVE) ---')
const sinistea = await get('https://www.pokeprices.io/set/Trick%20or%20Trade%202023/card/sinistea-89')
const sMarket = /Marketplace Snapshots/.test(sinistea.body)
const sFaq = sinistea.body.match(/currently reads([^"]{0,120})/)?.[1] || ''
const sPsa9 = /PSA\s*9:/i.test(sFaq)
console.log(`sinistea marketplace_panel=${sMarket} psa9_in_faq=${sPsa9} ${sMarket && !sPsa9 ? '✓ active' : '✗'}`)
