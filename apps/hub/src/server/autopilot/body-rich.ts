import 'server-only';

// DraftOutput → TipTap JSON (`body_rich`) converter.
//
// The YGO insights renderer accepts both body (markdown) and body_rich
// (TipTap JSON). We produce body_rich so the published page gets the
// exact structure the pipeline emitted — no markdown parse step in
// the middle.
//
// Shape matches what @tiptap/core produces for StarterKit nodes:
// paragraph, heading(level), bulletList, orderedList, listItem, link,
// image. We intentionally keep this narrow — only elements the YGO
// renderer already supports.

import type { DraftOutput } from './types';

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}
export type TiptapNode =
  | { type: 'paragraph'; content?: TiptapInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content: TiptapInline[] }
  | { type: 'image'; attrs: { src: string; alt?: string; title?: string } };
export type TiptapInline =
  | { type: 'text'; text: string; marks?: Array<{ type: 'link'; attrs: { href: string } } | { type: 'bold' } | { type: 'italic' }> };

export function draftToBodyRich(draft: DraftOutput): TiptapDoc {
  const content: TiptapNode[] = [];
  for (const section of draft.sections) {
    // H1 is reserved for the rendering layer (page template). Any
    // heading from the draft becomes H2 or H3.
    if (section.heading && section.heading_level && section.heading_level !== 1) {
      content.push({
        type: 'heading',
        attrs: { level: section.heading_level === 3 ? 3 : 2 },
        content: [{ type: 'text', text: section.heading }],
      });
    }
    for (const p of section.paragraphs) {
      const inline = toInline(p, section.internal_links);
      if (inline.length > 0) content.push({ type: 'paragraph', content: inline });
    }
    for (const img of section.images) {
      content.push({
        type: 'image',
        attrs: { src: img.source_url, alt: img.alt_text },
      });
    }
  }
  return { type: 'doc', content };
}

// Internal helper: convert a plain-text paragraph + known internal
// links into inline nodes. Any occurrence of an anchor substring
// becomes a link mark; everything else stays as text.
function toInline(paragraph: string, links: Array<{ anchor: string; target_url: string }>): TiptapInline[] {
  if (!paragraph) return [];
  const out: TiptapInline[] = [];
  let cursor = 0;
  // Simple greedy: scan for the longest anchor match at each position.
  const anchors = links
    .filter((l) => l.anchor && l.target_url)
    .sort((a, b) => b.anchor.length - a.anchor.length);
  while (cursor < paragraph.length) {
    let matched: { anchor: string; url: string; index: number } | null = null;
    for (const a of anchors) {
      const i = paragraph.indexOf(a.anchor, cursor);
      if (i !== -1 && (matched == null || i < matched.index)) {
        matched = { anchor: a.anchor, url: a.target_url, index: i };
      }
    }
    if (!matched) {
      out.push({ type: 'text', text: paragraph.slice(cursor) });
      break;
    }
    if (matched.index > cursor) {
      out.push({ type: 'text', text: paragraph.slice(cursor, matched.index) });
    }
    out.push({
      type: 'text',
      text: matched.anchor,
      marks: [{ type: 'link', attrs: { href: matched.url } }],
    });
    cursor = matched.index + matched.anchor.length;
  }
  return out.filter((n) => n.text.length > 0);
}

