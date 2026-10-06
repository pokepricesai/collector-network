import 'server-only';

// Deterministic external-source page extraction.
//
// Given a DiscoveredSignal URL, this module fetches the page (same
// polite constraints as discovery.ts) and extracts a compact text
// snapshot the writer can use as research material. It never
// reproduces more than a bounded excerpt — the AI prompt is told the
// text is RESEARCH, not copy, and the deterministic QA layer rejects
// closely-paraphrased reproduction.
//
// Guarantees:
//   * Only domains in network_autopilot_sources (enabled) are fetched.
//   * Response size + timeout bounded (2 MB / 12 s).
//   * Script, style, nav, footer, aside, form, iframe stripped out.
//   * Prefer <article> or <main>; fall back to <body>.
//   * Output truncated at 4000 chars.
//   * Open Graph image + published_at (meta property="article:published_time")
//     captured when present.
//   * sha256 of extracted text persisted so the same page across
//     syndicated feeds dedupes without re-fetching.

import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DiscoveredSignal } from './types';
import { listSources } from './sources';
import type { AutopilotSiteSlug } from './config';

const MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_EXTRACTED_CHARS = 4_000;
const UA = 'Collector-Network-Autopilot/1.0 (+contact: luke@collector-network)';

export interface ExtractionResult {
  signal_id: string;
  url: string;
  success: boolean;
  reason?: string;
  extracted_text?: string;
  content_hash?: string;
  og_image_url?: string | null;
  published_at?: string | null;
}

export async function extractSignal(sb: SupabaseClient, signal: DiscoveredSignal, siteSlug: AutopilotSiteSlug): Promise<ExtractionResult> {
  if (!signal.id) {
    return { signal_id: '', url: signal.url, success: false, reason: 'signal has no id — persist before extracting' };
  }
  const allowed = (await listSources(sb, siteSlug)).some((s) => s.enabled && s.domain === signal.domain);
  if (!allowed) {
    return { signal_id: signal.id, url: signal.url, success: false, reason: `domain ${signal.domain} not in enabled source registry` };
  }

  let text = '';
  try {
    text = await fetchHtml(signal.url);
  } catch (err) {
    return { signal_id: signal.id, url: signal.url, success: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const ogImage = extractMetaProp(text, 'og:image');
  const publishedAt = extractMetaProp(text, 'article:published_time') ?? extractMetaName(text, 'date') ?? null;
  const body = stripToMainText(text);
  const truncated = body.slice(0, MAX_EXTRACTED_CHARS);
  const content_hash = crypto.createHash('sha256').update(truncated).digest('hex');

  // Persist back to the signal row.
  await sb.from('network_autopilot_discovered_signals').update({
    extracted_text: truncated,
    content_hash,
    og_image_url_extracted: ogImage ?? null,
    extracted_at: new Date().toISOString(),
    published_at: publishedAt ?? signal.published_at,
  }).eq('id', signal.id);

  return {
    signal_id: signal.id,
    url: signal.url,
    success: true,
    extracted_text: truncated,
    content_hash,
    og_image_url: ogImage ?? null,
    published_at: publishedAt ?? signal.published_at,
  };
}

export async function extractSignalsForPack(sb: SupabaseClient, signals: DiscoveredSignal[], siteSlug: AutopilotSiteSlug, max = 3): Promise<ExtractionResult[]> {
  // Extract only the top N signals so we don't blow the function
  // budget on a page load. Polite 1s delay between fetches.
  const out: ExtractionResult[] = [];
  const slice = signals.slice(0, max);
  for (let i = 0; i < slice.length; i++) {
    const sig = slice[i]!;
    const result = await extractSignal(sb, sig, siteSlug);
    out.push(result);
    if (i < slice.length - 1) await sleep(1000);
  }
  return out;
}

// ─── Internal helpers ──────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
      cache: 'no-store',
    });
    if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > MAX_RESPONSE_BYTES) throw new Error(`response ${buf.byteLength} bytes exceeds ${MAX_RESPONSE_BYTES} cap`);
    return new TextDecoder('utf-8').decode(buf);
  } finally {
    clearTimeout(timer);
  }
}

// Readability-style minimal extraction. Preference order:
//   1. <article>
//   2. <main>
//   3. <body>
function stripToMainText(html: string): string {
  // Strip <script>, <style>, <noscript>, <iframe>, <form>, <nav>,
  // <aside>, <footer>, <svg>. These are rarely useful article text.
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const picked = pickSection(s, 'article') ?? pickSection(s, 'main') ?? pickSection(s, 'body') ?? s;
  const text = stripTags(picked);
  return text.replace(/\s+/g, ' ').trim();
}

function pickSection(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(html);
  return m ? m[1] ?? null : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function extractMetaProp(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+property=["']${escapeRe(property)}["'][^>]*content=["']([^"']+)["']`, 'i');
  const m = re.exec(html);
  if (m) return m[1] ?? null;
  // Try the other attribute order (content before property)
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*property=["']${escapeRe(property)}["']`, 'i');
  const m2 = re2.exec(html);
  return m2 ? m2[1] ?? null : null;
}

function extractMetaName(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+name=["']${escapeRe(name)}["'][^>]*content=["']([^"']+)["']`, 'i');
  const m = re.exec(html);
  return m ? m[1] ?? null : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
