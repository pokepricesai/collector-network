import 'server-only';

// Minimal HTML → markdown + HTML → PokePrices-block converters.
// Operates on the exact subset the article sanitiser allows (see
// server/content/sanitise.ts): p / h2 / h3 / strong / em / a / ul /
// ol / li / blockquote / img / figure / figcaption / br. Any tag
// outside that set is treated as plain text (the sanitiser already
// stripped unsafe markup).
//
// Deliberately dependency-free — tiny tag coverage, zero DOM.

interface Attrs { [key: string]: string }

interface Node {
  tag: string;   // '' for text
  text: string;  // text content for text nodes
  attrs: Attrs;
  children: Node[];
}

// ── Tokeniser ─────────────────────────────────────────────────

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)\/?>/g;
const SELF_CLOSING = new Set(['br', 'img']);

function parse(html: string): Node[] {
  // Collapse whitespace to make block boundaries explicit. We keep
  // intra-paragraph newlines as single spaces; markdown re-adds them.
  const src = html;
  const root: Node = { tag: '', text: '', attrs: {}, children: [] };
  const stack: Node[] = [root];
  let i = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(src))) {
    const start = m.index;
    const match = m[0];
    const name = m[1]!.toLowerCase();
    const attrsRaw = m[2] ?? '';
    const isClose = match.startsWith('</');
    const isSelfClosing = SELF_CLOSING.has(name) || /\/>$/.test(match);

    if (start > i) {
      const textChunk = decode(src.slice(i, start));
      if (textChunk) stack[stack.length - 1]!.children.push({ tag: '', text: textChunk, attrs: {}, children: [] });
    }

    if (isClose) {
      // Pop until we find the matching open; tolerate bad HTML.
      for (let s = stack.length - 1; s >= 1; s--) {
        if (stack[s]!.tag === name) { stack.length = s; break; }
      }
    } else if (isSelfClosing) {
      stack[stack.length - 1]!.children.push({ tag: name, text: '', attrs: parseAttrs(attrsRaw), children: [] });
    } else {
      const node: Node = { tag: name, text: '', attrs: parseAttrs(attrsRaw), children: [] };
      stack[stack.length - 1]!.children.push(node);
      stack.push(node);
    }
    i = TAG_RE.lastIndex;
  }
  if (i < src.length) {
    const tail = decode(src.slice(i));
    if (tail) root.children.push({ tag: '', text: tail, attrs: {}, children: [] });
  }
  return root.children;
}

function parseAttrs(raw: string): Attrs {
  const out: Attrs = {};
  const re = /([a-zA-Z-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)'|\s*=\s*(\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    out[m[1]!.toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── HTML → Markdown ──────────────────────────────────────────

export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return '';
  const nodes = parse(html);
  const out: string[] = [];
  for (const n of nodes) {
    const chunk = renderBlockToMd(n);
    if (chunk) out.push(chunk);
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function renderBlockToMd(n: Node): string {
  switch (n.tag) {
    case 'h2': return `## ${inlineMd(n)}`;
    case 'h3': return `### ${inlineMd(n)}`;
    case 'p':  return inlineMd(n);
    case 'blockquote': return inlineMd(n).split(/\n+/).map((l) => `> ${l}`).join('\n');
    case 'ul': return listMd(n, false);
    case 'ol': return listMd(n, true);
    case 'figure': return figureMd(n);
    case 'img': return imageMd(n);
    case '': {
      const t = n.text.trim();
      return t ? t : '';
    }
    default: return inlineMd(n);
  }
}

function listMd(n: Node, ordered: boolean): string {
  const items: string[] = [];
  let i = 1;
  for (const child of n.children) {
    if (child.tag !== 'li') continue;
    const marker = ordered ? `${i++}.` : '-';
    items.push(`${marker} ${inlineMd(child)}`);
  }
  return items.join('\n');
}

function figureMd(n: Node): string {
  let imgMd = '';
  let caption = '';
  for (const c of n.children) {
    if (c.tag === 'img') imgMd = imageMd(c);
    else if (c.tag === 'figcaption') caption = inlineMd(c);
  }
  if (!imgMd) return '';
  return caption ? `${imgMd}\n*${caption}*` : imgMd;
}

function imageMd(n: Node): string {
  const src = n.attrs['src'] ?? '';
  const alt = (n.attrs['alt'] ?? '').replace(/\]/g, '');
  if (!src) return '';
  return `![${alt}](${src})`;
}

function inlineMd(n: Node): string {
  let out = '';
  for (const c of n.children) {
    if (c.tag === '') { out += c.text; continue; }
    if (c.tag === 'br') { out += '  \n'; continue; }
    if (c.tag === 'strong' || c.tag === 'b') { out += `**${inlineMd(c)}**`; continue; }
    if (c.tag === 'em' || c.tag === 'i') { out += `*${inlineMd(c)}*`; continue; }
    if (c.tag === 'a') {
      const href = c.attrs['href'] ?? '';
      const label = inlineMd(c);
      out += href ? `[${label}](${href})` : label;
      continue;
    }
    out += inlineMd(c);
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ── HTML → PokePrices block JSON ─────────────────────────────
//
// PokePrices body_json shape (see pokeprices-web/src/lib/insights/
// richText.ts): a union of heading / paragraph / image blocks.
//
//   heading   = { type: 'heading',   text: string }
//   paragraph = { type: 'paragraph', content: [{ text, bold?, href? }] }
//   image     = { type: 'image',     src, alt, caption? }
//
// Lists are flattened to bullet-prefixed paragraphs (PokePrices has
// no list block). Blockquotes become italicised paragraphs so the
// quote marker survives the conversion.

export type PokeSegment = { text: string; bold?: boolean; href?: string };
export type PokeBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; content: PokeSegment[] }
  | { type: 'image'; src: string; alt: string; caption?: string };

export function htmlToPokeBlocks(html: string): PokeBlock[] {
  if (!html || !html.trim()) return [];
  const nodes = parse(html);
  const out: PokeBlock[] = [];
  for (const n of nodes) renderBlockToPoke(n, out);
  // Collapse consecutive empty paragraphs.
  return out.filter((b) => b.type !== 'paragraph' || (b.type === 'paragraph' && b.content.length > 0));
}

function renderBlockToPoke(n: Node, out: PokeBlock[]): void {
  switch (n.tag) {
    case 'h2':
    case 'h3':
      out.push({ type: 'heading', text: inlinePlain(n) });
      return;
    case 'p': {
      const content = inlineSegments(n);
      if (content.length > 0) out.push({ type: 'paragraph', content });
      return;
    }
    case 'ul':
    case 'ol': {
      let i = 1;
      const ordered = n.tag === 'ol';
      for (const child of n.children) {
        if (child.tag !== 'li') continue;
        const segs = inlineSegments(child);
        if (segs.length === 0) continue;
        const prefix = ordered ? `${i++}. ` : '• ';
        segs.unshift({ text: prefix });
        out.push({ type: 'paragraph', content: coalesce(segs) });
      }
      return;
    }
    case 'blockquote': {
      const segs = inlineSegments(n);
      if (segs.length > 0) out.push({ type: 'paragraph', content: segs.map((s) => ({ ...s, text: s.text })) });
      return;
    }
    case 'figure': {
      let src = ''; let alt = ''; let caption: string | undefined;
      for (const c of n.children) {
        if (c.tag === 'img') { src = c.attrs['src'] ?? ''; alt = c.attrs['alt'] ?? ''; }
        else if (c.tag === 'figcaption') { caption = inlinePlain(c); }
      }
      if (src) out.push({ type: 'image', src, alt, ...(caption ? { caption } : {}) });
      return;
    }
    case 'img': {
      const src = n.attrs['src'] ?? '';
      const alt = n.attrs['alt'] ?? '';
      if (src) out.push({ type: 'image', src, alt });
      return;
    }
    case '': {
      const t = n.text.trim();
      if (t) out.push({ type: 'paragraph', content: [{ text: t }] });
      return;
    }
    default: {
      const content = inlineSegments(n);
      if (content.length > 0) out.push({ type: 'paragraph', content });
      return;
    }
  }
}

function inlineSegments(n: Node, ctx: { bold?: boolean; href?: string } = {}): PokeSegment[] {
  const out: PokeSegment[] = [];
  for (const c of n.children) {
    if (c.tag === '') { if (c.text) out.push({ text: c.text, ...(ctx.bold ? { bold: true } : {}), ...(ctx.href ? { href: ctx.href } : {}) }); continue; }
    if (c.tag === 'br') { out.push({ text: ' ' }); continue; }
    if (c.tag === 'strong' || c.tag === 'b') { out.push(...inlineSegments(c, { ...ctx, bold: true })); continue; }
    if (c.tag === 'em' || c.tag === 'i') { out.push(...inlineSegments(c, ctx)); continue; }
    if (c.tag === 'a') { out.push(...inlineSegments(c, { ...ctx, href: c.attrs['href'] ?? ctx.href })); continue; }
    out.push(...inlineSegments(c, ctx));
  }
  return coalesce(out);
}

function inlinePlain(n: Node): string {
  let out = '';
  for (const c of n.children) {
    if (c.tag === '') { out += c.text; continue; }
    if (c.tag === 'br') { out += ' '; continue; }
    out += inlinePlain(c);
  }
  return out.replace(/\s+/g, ' ').trim();
}

function coalesce(segs: PokeSegment[]): PokeSegment[] {
  const out: PokeSegment[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && !!last.bold === !!s.bold && (last.href ?? '') === (s.href ?? '')) {
      last.text += s.text;
    } else {
      out.push({ ...s });
    }
  }
  return out.filter((s) => s.text && s.text.trim().length > 0 || /^[0-9]+\. $|^• $/.test(s.text));
}

// ── YAML frontmatter emission ────────────────────────────────
//
// gray-matter is permissive but we still emit a strict YAML subset
// so manually-edited frontmatter stays legible. All string values are
// double-quoted with internal double-quotes escaped. Dates stay bare.

export function emitYamlFrontmatter(fields: Record<string, string | number | string[] | null | undefined>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlString(String(item))}`);
      continue;
    }
    if (typeof v === 'number') { lines.push(`${k}: ${v}`); continue; }
    const s = String(v);
    // ISO dates (YYYY-MM-DD) are safe bare.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { lines.push(`${k}: ${s}`); continue; }
    lines.push(`${k}: ${yamlString(s)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function yamlString(s: string): string {
  // Always double-quote; escape backslashes and double-quotes.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
