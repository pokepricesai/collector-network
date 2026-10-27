import 'server-only';

// CN-05 OS Phase A.1 — Paste-draft import.
//
// Parses the structured JSON Claude Code returns from the writing-brief
// prompt, converts the Markdown body into TipTap-compatible HTML, and
// hands back the materials the Server Action will persist via the
// canonical article creation pathway.
//
// Deliberately narrow Markdown subset — matches the writing brief's
// output contract AND the TipTap editor's allowed tags via
// sanitiseEditorHtml. Unknown Markdown just degrades into paragraphs
// (never raw HTML), so Claude cannot smuggle arbitrary tags past the
// server sanitiser.

export interface PasteDraftInput {
  idea_id?: string | null;
  title: string;
  slug?: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  standfirst?: string | null;
  summary?: string | null;
  body_markdown: string;
  internal_links?: Array<{ anchor: string; target_url: string }>;
  sources?: Array<{ claim: string; source: string }>;
  notes_for_editor?: string | null;
}

const MAX = {
  title: 300,
  slug: 120,
  meta_title: 200,
  meta_description: 400,
  summary: 400,
  standfirst: 400,
  body_markdown: 60_000,
  internal_links: 50,
  anchor: 200,
  url: 500,
  sources: 50,
  source_claim: 500,
  source_name: 500,
  notes_for_editor: 2_000,
};

export type ParseOutcome =
  | { ok: true; value: PasteDraftInput }
  | { ok: false; error: string; path?: string };

export function parseAndValidatePaste(raw: string): ParseOutcome {
  if (typeof raw !== 'string') return { ok: false, error: 'empty paste' };
  const extracted = extractJsonObject(raw);
  if (!extracted) return { ok: false, error: 'no JSON object found in paste' };
  let parsed: unknown;
  try { parsed = JSON.parse(extracted); } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  if (!isRecord(parsed)) return { ok: false, error: 'paste is not a JSON object' };

  const title = asString(parsed['title'], MAX.title);
  if (!title) return { ok: false, error: 'title is required', path: 'title' };
  const body = asString(parsed['body_markdown'], MAX.body_markdown);
  if (!body) return { ok: false, error: 'body_markdown is required', path: 'body_markdown' };

  const linksRaw = Array.isArray(parsed['internal_links']) ? parsed['internal_links'] : [];
  const internal_links: Array<{ anchor: string; target_url: string }> = [];
  for (let i = 0; i < Math.min(linksRaw.length, MAX.internal_links); i++) {
    const r = linksRaw[i];
    if (!isRecord(r)) continue;
    const anchor = asString(r['anchor'], MAX.anchor);
    const target_url = asString(r['target_url'], MAX.url);
    if (anchor && target_url) internal_links.push({ anchor, target_url });
  }

  const sourcesRaw = Array.isArray(parsed['sources']) ? parsed['sources'] : [];
  const sources: Array<{ claim: string; source: string }> = [];
  for (let i = 0; i < Math.min(sourcesRaw.length, MAX.sources); i++) {
    const r = sourcesRaw[i];
    if (!isRecord(r)) continue;
    const claim = asString(r['claim'], MAX.source_claim);
    const source = asString(r['source'], MAX.source_name);
    if (claim && source) sources.push({ claim, source });
  }

  const value: PasteDraftInput = {
    idea_id: typeof parsed['idea_id'] === 'string' ? (parsed['idea_id'] as string) : null,
    title,
    slug: asString(parsed['slug'], MAX.slug) || null,
    meta_title: asString(parsed['meta_title'], MAX.meta_title) || null,
    meta_description: asString(parsed['meta_description'], MAX.meta_description) || null,
    standfirst: asString(parsed['standfirst'], MAX.standfirst) || null,
    summary: asString(parsed['summary'], MAX.summary) || null,
    body_markdown: body,
    internal_links,
    sources,
    notes_for_editor: asString(parsed['notes_for_editor'], MAX.notes_for_editor) || null,
  };
  return { ok: true, value };
}

function asString(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Walk `s` for the first balanced {…} object. Tolerates prose
 *  before/after and ignores braces inside strings. Returns the raw
 *  JSON substring or null. */
function extractJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/** Minimal Markdown → HTML converter. Produces only tags the server
 *  sanitiser (sanitiseEditorHtml) will keep: p, h2, h3, strong, em, a,
 *  ul, ol, li, blockquote, br. Code fences and images are converted to
 *  paragraphs on purpose — image handling runs through the OS media
 *  bucket, not inline inserts from Claude.
 *
 *  This is a small block-level walker rather than a full-spec parser.
 *  Keeping the surface narrow is a feature: the sanitiser is the last
 *  line of defence, but writers producing extravagant Markdown should
 *  see a predictable fallback instead of guessing which heading levels
 *  survived. */
export function markdownToTipTapHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (/^\s*$/.test(line)) { i++; continue; }
    const trimmed = line.trim();

    // H1 is collapsed to H2 — the article title column holds the H1.
    const h1 = /^#\s+(.*)$/.exec(trimmed);
    if (h1) { out.push(`<h2>${inline(h1[1] ?? '')}</h2>`); i++; continue; }
    const h2 = /^##\s+(.*)$/.exec(trimmed);
    if (h2) { out.push(`<h2>${inline(h2[1] ?? '')}</h2>`); i++; continue; }
    const h3 = /^###\s+(.*)$/.exec(trimmed);
    if (h3) { out.push(`<h3>${inline(h3[1] ?? '')}</h3>`); i++; continue; }
    const h456 = /^#{4,6}\s+(.*)$/.exec(trimmed);
    if (h456) { out.push(`<h3>${inline(h456[1] ?? '')}</h3>`); i++; continue; }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? '').trim())) {
        quote.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i++;
      }
      out.push(`<blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      out.push('<ul>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ul>');
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
        items.push((lines[i] ?? '').replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push('<ol>' + items.map((it) => `<li>${inline(it)}</li>`).join('') + '</ol>');
      continue;
    }

    // Paragraph — accumulate consecutive non-blank, non-structural lines.
    const para: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? '';
      if (/^\s*$/.test(cur)) break;
      if (/^(\s*#{1,6}\s|>\s?|\s*[-*]\s+|\s*\d+\.\s+)/.test(cur)) break;
      para.push(cur.trim());
      i++;
    }
    if (para.length > 0) out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** Inline-level: links, strong, em, hard-break. HTML-escape text
 *  first, then re-introduce the markup. */
function inline(text: string): string {
  let s = escapeHtml(text);
  // links  [label](url) — url is bounded to http(s) in sanitiser.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const u = url.trim();
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return label;
    return `<a href="${escapeAttr(u)}">${label}</a>`;
  });
  // strong **x** then em *x* / _x_
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');
  // Explicit <br> on two trailing spaces is a Markdown convention.
  s = s.replace(/\s{2,}\n?$/g, '<br>');
  return s;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
function escapeAttr(s: string): string { return escapeHtml(s); }
