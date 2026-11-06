import 'server-only';

// CN-STOCK-02 · TS port of scripts/_cn-stock-01/extract.mjs.
// The algorithm is identical — JSON-LD → meta → microdata with
// strict identity matching. See the .mjs original for the full
// rationale comments.

import type { ExtractionMethod } from './types';

const AVAIL_IN_STOCK = /^(?:https?:\/\/)?schema\.org\/InStock$/i;
const AVAIL_OUT_OF_STOCK = /^(?:https?:\/\/)?schema\.org\/(?:OutOfStock|SoldOut|Discontinued)$/i;
const AVAIL_PREORDER = /^(?:https?:\/\/)?schema\.org\/(?:PreOrder|PreSale)$/i;
const AVAIL_BACKORDER = /^(?:https?:\/\/)?schema\.org\/BackOrder$/i;

interface Signal {
  state: 'in_stock' | 'out_of_stock' | 'preorder';
  source: ExtractionMethod;
  evidence: string;
}

export interface ClassifyResult {
  result: 'in_stock' | 'out_of_stock' | 'preorder' | 'unknown';
  extraction_method: ExtractionMethod;
  evidence_summary: string;
  price: number | null;
  currency: string | null;
  identity_match: boolean | null;
}

export function parseJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  if (typeof html !== 'string' || html.length === 0) return out;
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) != null) {
    const raw = (m[1] ?? '').trim();
    if (!raw) continue;
    try { pushFlat(out, JSON.parse(raw)); } catch { /* skip malformed */ }
  }
  return out;
}

function pushFlat(acc: unknown[], node: unknown): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) pushFlat(acc, n); return; }
  if (typeof node !== 'object') return;
  acc.push(node);
  const graph = (node as { '@graph'?: unknown[] })['@graph'];
  if (Array.isArray(graph)) for (const g of graph) pushFlat(acc, g);
}

interface Product { name?: string; offers?: Offer | Offer[] | null }
interface Offer {
  availability?: string;
  price?: number | string;
  lowPrice?: number | string;
  priceCurrency?: string;
  priceSpecification?: { price?: number | string; priceCurrency?: string };
  '@type'?: string | string[];
}

export function findProductOffers(ldBlocks: unknown[]): Array<{ product: Product; offer: Offer | null }> {
  const out: Array<{ product: Product; offer: Offer | null }> = [];
  for (const node of ldBlocks) {
    if (!isType(node, 'Product')) continue;
    const prod = node as Product;
    const o = prod.offers;
    if (o == null) { out.push({ product: prod, offer: null }); continue; }
    const list = Array.isArray(o) ? o : [o];
    const matched: Offer[] = [];
    for (const off of list) {
      if (off && typeof off === 'object' && (isType(off, 'Offer') || isType(off, 'AggregateOffer') || (off as Offer).availability)) {
        matched.push(off as Offer);
      }
    }
    if (matched.length === 0) out.push({ product: prod, offer: null });
    else for (const off of matched) out.push({ product: prod, offer: off });
  }
  return out;
}

function isType(node: unknown, name: string): boolean {
  if (node == null || typeof node !== 'object') return false;
  const t = (node as { '@type'?: string | string[] })['@type'];
  if (t == null) return false;
  if (typeof t === 'string') return t.toLowerCase() === name.toLowerCase();
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && x.toLowerCase() === name.toLowerCase());
  return false;
}

export function offerSignal(offer: Offer | null): Signal | null {
  if (!offer || typeof offer !== 'object') return null;
  const a = offer.availability;
  if (typeof a !== 'string') return null;
  if (AVAIL_IN_STOCK.test(a)) return { state: 'in_stock', source: 'json_ld', evidence: `Offer.availability=${a}` };
  if (AVAIL_OUT_OF_STOCK.test(a)) return { state: 'out_of_stock', source: 'json_ld', evidence: `Offer.availability=${a}` };
  if (AVAIL_PREORDER.test(a)) return { state: 'preorder', source: 'json_ld', evidence: `Offer.availability=${a}` };
  if (AVAIL_BACKORDER.test(a)) return { state: 'out_of_stock', source: 'json_ld', evidence: `Offer.availability=${a} (backorder)` };
  return null;
}

const META_IN_STOCK = /\b(in[\s_-]?stock|instock|available|available_for_order)\b/i;
const META_OUT_STOCK = /\b(out[\s_-]?of[\s_-]?stock|outofstock|oos|sold[\s_-]?out|unavailable|discontinued)\b/i;
const META_PREORDER = /\b(pre[\s_-]?order|preorder|preordre)\b/i;

export function metaAvailabilitySignal(html: string): Signal | null {
  if (typeof html !== 'string') return null;
  const re = /<meta[^>]+property=["'](?:product:availability|og:availability)["'][^>]+content=["']([^"']+)["']/i;
  const m = re.exec(html);
  if (!m) return null;
  const content = (m[1] ?? '').trim();
  if (!content) return null;
  if (META_IN_STOCK.test(content)) return { state: 'in_stock', source: 'meta', evidence: `og.availability=${content}` };
  if (META_OUT_STOCK.test(content)) return { state: 'out_of_stock', source: 'meta', evidence: `og.availability=${content}` };
  if (META_PREORDER.test(content)) return { state: 'preorder', source: 'meta', evidence: `og.availability=${content}` };
  return null;
}

export function microdataAvailabilitySignal(html: string): Signal | null {
  if (typeof html !== 'string') return null;
  const re = /itemprop=["']availability["'][^>]*(?:href|content)=["']([^"']+)["']/i;
  const m = re.exec(html);
  if (!m) return null;
  const val = (m[1] ?? '').trim();
  if (AVAIL_IN_STOCK.test(val)) return { state: 'in_stock', source: 'microdata', evidence: `itemprop=availability ${val}` };
  if (AVAIL_OUT_OF_STOCK.test(val)) return { state: 'out_of_stock', source: 'microdata', evidence: `itemprop=availability ${val}` };
  if (AVAIL_PREORDER.test(val)) return { state: 'preorder', source: 'microdata', evidence: `itemprop=availability ${val}` };
  if (AVAIL_BACKORDER.test(val)) return { state: 'out_of_stock', source: 'microdata', evidence: `itemprop=availability ${val} (backorder)` };
  return null;
}

export function pageTitle(html: string): string | null {
  if (typeof html !== 'string') return null;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return (m[1] ?? '').replace(/\s+/g, ' ').trim() || null;
}

export function identityMatches(expected: string, product: Product | null, title: string | null): boolean | null {
  if (typeof expected !== 'string' || !expected.trim()) return null;
  const want = normalizeIdentity(expected);
  const candidates: string[] = [];
  if (product && typeof product.name === 'string') candidates.push(normalizeIdentity(product.name));
  if (title) candidates.push(normalizeIdentity(title));
  if (candidates.length === 0) return null;
  const wantTokens = want.split(' ').filter((t) => t.length >= 4);
  if (wantTokens.length === 0) return null;
  for (const c of candidates) {
    const cTokens = new Set(c.split(' '));
    const hits = wantTokens.filter((t) => cTokens.has(t)).length;
    if (hits / wantTokens.length >= 0.6) return true;
  }
  return false;
}

function normalizeIdentity(s: string): string {
  return s
    .replace(/[–—‐‑]/g, '-')
    .replace(/[^a-z0-9\s-]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function classify(html: string, expectedName: string, options: { strictIdentity?: boolean } = {}): ClassifyResult {
  const strictIdentity = options.strictIdentity !== false;
  const ldBlocks = parseJsonLdBlocks(html);
  const productOffers = findProductOffers(ldBlocks);
  const title = pageTitle(html);

  const signals: Signal[] = [];
  let matchedProduct: Product | null = null;
  let matchedOffer: Offer | null = null;
  for (const { product, offer } of productOffers) {
    const sig = offerSignal(offer);
    if (!sig) continue;
    const match = identityMatches(expectedName, product, title);
    if (match === false) continue;
    signals.push(sig);
    matchedProduct = product;
    matchedOffer = offer;
    break;
  }

  if (signals.length === 0) {
    const meta = metaAvailabilitySignal(html);
    if (meta) signals.push(meta);
  }

  if (signals.length === 0) {
    const micro = microdataAvailabilitySignal(html);
    if (micro) signals.push(micro);
  }

  const uniqStates = Array.from(new Set(signals.map((s) => s.state)));
  let result: ClassifyResult['result'];
  let extraction_method: ExtractionMethod;
  let evidence_summary: string;
  if (uniqStates.length === 0) {
    result = 'unknown';
    extraction_method = 'none';
    evidence_summary = 'no availability signal found';
  } else if (uniqStates.length === 1) {
    const sig = signals[0]!;
    result = sig.state;
    extraction_method = sig.source;
    evidence_summary = sig.evidence;
  } else {
    result = 'unknown';
    extraction_method = signals[0]!.source;
    evidence_summary = `conflicting signals: ${signals.map((s) => `${s.source}=${s.state}`).join(' | ')}`;
  }

  const idMatch = identityMatches(expectedName, matchedProduct, title);
  if (strictIdentity && result !== 'unknown' && idMatch === false) {
    return {
      result: 'unknown',
      extraction_method,
      evidence_summary: `identity mismatch (signal was ${result}): ${evidence_summary}`,
      price: null,
      currency: null,
      identity_match: false,
    };
  }

  return {
    result,
    extraction_method,
    evidence_summary,
    price: extractPrice(matchedOffer),
    currency: extractCurrency(matchedOffer),
    identity_match: idMatch,
  };
}

function extractPrice(offer: Offer | null): number | null {
  if (!offer) return null;
  const p = offer.price ?? offer.lowPrice ?? offer.priceSpecification?.price;
  if (typeof p === 'number' && Number.isFinite(p)) return p;
  if (typeof p === 'string') {
    const n = Number.parseFloat(p.replace(/[^0-9.-]+/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractCurrency(offer: Offer | null): string | null {
  if (!offer) return null;
  const c = offer.priceCurrency ?? offer.priceSpecification?.priceCurrency;
  return typeof c === 'string' ? c.toUpperCase() : null;
}
