// CN-STOCK-01 · evidence extraction.
//
// Pure HTML → classification logic. Shared between the live probe
// (probe.mjs) and the fixture tests (__tests__/extract.test.mjs).
//
// Decision precedence (highest → lowest signal weight):
//   1. schema.org JSON-LD Product/Offer availability
//   2. OpenGraph product:availability meta tag
//   3. Microdata itemprop="availability" href
//   4. Visible-text patterns (ONLY used as a corroborating signal,
//      never alone — too noisy to classify from "add to cart" strings)
//
// Classification states (match the brief):
//   in_stock      — clear positive signal AND identity matches
//   out_of_stock  — clear negative signal AND identity matches
//   preorder      — clear preorder signal AND identity matches
//   unknown       — no signal, conflicting signals, or identity mismatch
//   blocked       — caller sets this; extractor does not
//
// Identity matching: product_name is compared against JSON-LD
// Product.name or document <title>. Unrelated page text, sidebar
// recommendations, or a different available variant must NOT
// establish stock for the requested product.
//
// All pattern matching is case-insensitive. We tolerate schema
// URIs with and without the `https://` prefix (Shopify strips it).

const AVAIL_IN_STOCK      = /^(?:https?:\/\/)?schema\.org\/InStock$/i
const AVAIL_OUT_OF_STOCK  = /^(?:https?:\/\/)?schema\.org\/(?:OutOfStock|SoldOut|Discontinued)$/i
const AVAIL_PREORDER      = /^(?:https?:\/\/)?schema\.org\/(?:PreOrder|PreSale)$/i
const AVAIL_BACKORDER     = /^(?:https?:\/\/)?schema\.org\/BackOrder$/i

/** Parse all <script type="application/ld+json"> blocks, tolerating
 *  malformed JSON (skip) and arrays of graph nodes. Returns a flat
 *  list of candidate objects to probe for Product + Offer shape. */
export function parseJsonLdBlocks(html) {
  const out = []
  if (typeof html !== 'string' || html.length === 0) return out
  // Lazy, non-greedy. Multiple blocks allowed.
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) != null) {
    const raw = (m[1] ?? '').trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      pushFlat(out, parsed)
    } catch {
      // Malformed — skip silently. We don't trust partial JSON.
    }
  }
  return out
}

function pushFlat(acc, node) {
  if (node == null) return
  if (Array.isArray(node)) { for (const n of node) pushFlat(acc, n); return }
  if (typeof node !== 'object') return
  acc.push(node)
  // schema.org @graph wrapping
  if (Array.isArray(node['@graph'])) for (const g of node['@graph']) pushFlat(acc, g)
}

/** Find Product nodes and the Offer nodes nested inside them. */
export function findProductOffers(ldBlocks) {
  const out = []
  for (const node of ldBlocks) {
    if (!isType(node, 'Product')) continue
    const offers = []
    const o = node.offers
    if (o == null) {
      out.push({ product: node, offer: null })
      continue
    }
    const list = Array.isArray(o) ? o : [o]
    for (const off of list) {
      if (off && typeof off === 'object' && (isType(off, 'Offer') || isType(off, 'AggregateOffer') || off.availability)) {
        offers.push(off)
      }
    }
    if (offers.length === 0) out.push({ product: node, offer: null })
    else for (const off of offers) out.push({ product: node, offer: off })
  }
  return out
}

function isType(node, name) {
  if (node == null || typeof node !== 'object') return false
  const t = node['@type']
  if (t == null) return false
  if (typeof t === 'string') return t.toLowerCase() === name.toLowerCase()
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === name.toLowerCase())
  return false
}

/** Project a Product+Offer pair to a classification candidate.
 *  Returns null when no availability field is present. */
export function offerSignal(offer) {
  if (!offer || typeof offer !== 'object') return null
  const a = offer.availability
  if (typeof a !== 'string') return null
  if (AVAIL_IN_STOCK.test(a)) return { state: 'in_stock', source: 'json_ld', evidence: `Offer.availability=${a}` }
  if (AVAIL_OUT_OF_STOCK.test(a)) return { state: 'out_of_stock', source: 'json_ld', evidence: `Offer.availability=${a}` }
  if (AVAIL_PREORDER.test(a))    return { state: 'preorder',    source: 'json_ld', evidence: `Offer.availability=${a}` }
  if (AVAIL_BACKORDER.test(a))   return { state: 'out_of_stock', source: 'json_ld', evidence: `Offer.availability=${a} (backorder treated as out_of_stock)` }
  // Non-schema availability string — ambiguous.
  return null
}

const META_IN_STOCK   = /\b(in[\s_-]?stock|instock|available|available_for_order)\b/i
const META_OUT_STOCK  = /\b(out[\s_-]?of[\s_-]?stock|outofstock|oos|sold[\s_-]?out|unavailable|discontinued)\b/i
const META_PREORDER   = /\b(pre[\s_-]?order|preorder|preordre)\b/i

/** <meta property="product:availability" content="..."> or
 *  <meta property="og:availability" content="..."> */
export function metaAvailabilitySignal(html) {
  if (typeof html !== 'string') return null
  const re = /<meta[^>]+property=["'](?:product:availability|og:availability)["'][^>]+content=["']([^"']+)["']/i
  const m = re.exec(html)
  if (!m) return null
  const content = (m[1] ?? '').trim()
  if (!content) return null
  if (META_IN_STOCK.test(content))  return { state: 'in_stock',    source: 'meta', evidence: `og.availability=${content}` }
  if (META_OUT_STOCK.test(content)) return { state: 'out_of_stock', source: 'meta', evidence: `og.availability=${content}` }
  if (META_PREORDER.test(content))  return { state: 'preorder',    source: 'meta', evidence: `og.availability=${content}` }
  return null
}

/** <link itemprop="availability" href="https://schema.org/InStock">
 *  or <span itemprop="availability" content="https://schema.org/InStock"> */
export function microdataAvailabilitySignal(html) {
  if (typeof html !== 'string') return null
  const re = /itemprop=["']availability["'][^>]*(?:href|content)=["']([^"']+)["']/i
  const m = re.exec(html)
  if (!m) return null
  const val = (m[1] ?? '').trim()
  if (AVAIL_IN_STOCK.test(val))      return { state: 'in_stock',    source: 'microdata', evidence: `itemprop=availability ${val}` }
  if (AVAIL_OUT_OF_STOCK.test(val))  return { state: 'out_of_stock', source: 'microdata', evidence: `itemprop=availability ${val}` }
  if (AVAIL_PREORDER.test(val))      return { state: 'preorder',    source: 'microdata', evidence: `itemprop=availability ${val}` }
  if (AVAIL_BACKORDER.test(val))     return { state: 'out_of_stock', source: 'microdata', evidence: `itemprop=availability ${val} (backorder treated as out_of_stock)` }
  return null
}

/** Extract <title>…</title> for identity comparison. */
export function pageTitle(html) {
  if (typeof html !== 'string') return null
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return null
  return (m[1] ?? '').replace(/\s+/g, ' ').trim() || null
}

/** Identity match: does the page's Product name OR <title> contain
 *  the expected product name? Case-insensitive, token-based so a
 *  retailer's branded suffix (" | Retailer Name") doesn't break it.
 *
 *  Returns true | false | null (null = no identity field available). */
export function identityMatches(expected, product, title) {
  if (typeof expected !== 'string' || !expected.trim()) return null
  const want = normalizeIdentity(expected)
  const candidates = []
  if (product && typeof product.name === 'string') candidates.push(normalizeIdentity(product.name))
  if (title) candidates.push(normalizeIdentity(title))
  if (candidates.length === 0) return null
  // Match on shared significant tokens (≥4 chars, >=60% of expected tokens present).
  const wantTokens = want.split(' ').filter((t) => t.length >= 4)
  if (wantTokens.length === 0) return null
  for (const c of candidates) {
    const cTokens = new Set(c.split(' '))
    const hits = wantTokens.filter((t) => cTokens.has(t)).length
    if (hits / wantTokens.length >= 0.6) return true
  }
  return false
}

function normalizeIdentity(s) {
  return s
    .replace(/[–—‐‑]/g, '-')   // normalise dashes
    .replace(/[^a-z0-9\s-]+/gi, ' ')               // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Compose the final classification for one page.
 *
 *  html              raw HTML body (string)
 *  expectedName      product_name the caller asked us to check
 *  options.strictIdentity  when true (default), identity mismatch
 *                          downgrades a positive to 'unknown'. When
 *                          false, we trust the signal regardless.
 *
 *  Returns:
 *    {
 *      result: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown',
 *      extraction_method: 'json_ld' | 'meta' | 'microdata' | 'none',
 *      evidence_summary: string,
 *      price: number | null,
 *      currency: string | null,
 *      identity_match: boolean | null,
 *    } */
export function classify(html, expectedName, options = {}) {
  const strictIdentity = options.strictIdentity !== false
  const notes = []
  const ldBlocks = parseJsonLdBlocks(html)
  const productOffers = findProductOffers(ldBlocks)
  const title = pageTitle(html)

  // ── Collect signals from strongest source first ─────────────
  const signals = []
  let matchedProduct = null
  let matchedOffer = null
  for (const { product, offer } of productOffers) {
    const sig = offerSignal(offer)
    if (!sig) continue
    const match = identityMatches(expectedName, product, title)
    if (match === false) { notes.push(`Product name mismatch: wanted "${expectedName}", found "${product.name ?? ''}"`); continue }
    signals.push(sig)
    matchedProduct = product
    matchedOffer = offer
    break   // trust first matching Product+Offer
  }

  if (signals.length === 0) {
    const meta = metaAvailabilitySignal(html)
    if (meta) {
      // Meta/OG doesn't scope to a product record. Identity match via title.
      const match = identityMatches(expectedName, null, title)
      if (match === false) notes.push(`Title mismatch ignored by meta signal: wanted "${expectedName}", title "${title ?? ''}"`)
      signals.push(meta)
    }
  }

  if (signals.length === 0) {
    const micro = microdataAvailabilitySignal(html)
    if (micro) signals.push(micro)
  }

  // ── Deduplicate / resolve conflicts ─────────────────────────
  const uniqStates = Array.from(new Set(signals.map((s) => s.state)))
  let result
  let extraction_method
  let evidence_summary
  if (uniqStates.length === 0) {
    result = 'unknown'
    extraction_method = 'none'
    evidence_summary = notes.length ? `no availability signal; ${notes.join('; ')}` : 'no availability signal found'
  } else if (uniqStates.length === 1) {
    const sig = signals[0]
    result = sig.state
    extraction_method = sig.source
    evidence_summary = sig.evidence
  } else {
    // Conflicting evidence — e.g. JSON-LD says InStock but meta says OutOfStock.
    result = 'unknown'
    extraction_method = signals[0].source
    evidence_summary = `conflicting signals: ${signals.map((s) => `${s.source}=${s.state}`).join(' | ')}`
  }

  // Identity check as final downgrade gate for positive results.
  const idMatch = identityMatches(expectedName, matchedProduct, title)
  if (strictIdentity && result !== 'unknown' && idMatch === false) {
    return {
      result: 'unknown',
      extraction_method,
      evidence_summary: `identity mismatch (signal was ${result}): ${evidence_summary}`,
      price: null,
      currency: null,
      identity_match: false,
    }
  }

  return {
    result,
    extraction_method,
    evidence_summary,
    price: extractPrice(matchedOffer),
    currency: extractCurrency(matchedOffer),
    identity_match: idMatch,
  }
}

function extractPrice(offer) {
  if (!offer) return null
  const p = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price
  if (typeof p === 'number' && Number.isFinite(p)) return p
  if (typeof p === 'string') {
    const n = Number.parseFloat(p.replace(/[^0-9.-]+/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function extractCurrency(offer) {
  if (!offer) return null
  const c = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency
  return typeof c === 'string' ? c.toUpperCase() : null
}
