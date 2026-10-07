import 'server-only';

// DraftOutput → TipTap JSON (`body_rich`) converter.
//
// The YGO insights renderer accepts both body (markdown) and body_rich
// (TipTap JSON). We produce body_rich so the published page gets the
// exact structure the pipeline emitted — no markdown parse step in
// the middle.
//
// Shape matches what @tiptap/core produces for StarterKit nodes:
// paragraph, heading(level), image, with text + link / bold / italic
// marks. We intentionally keep this narrow — only elements the YGO
// renderer already supports.
//
// Checkpoint C hardening: even though the deterministic QA pass flags
// markdown-in-paragraphs as blockers (so a draft with markdown leaks
// never auto-publishes), the converter here still parses inline
// markdown. That way the admin preview shows what the article WOULD
// look like after repair, instead of literal "![alt](url)" text.
// The four markdown shapes handled:
//   ![alt](url)   → image node (splits the paragraph)
//   [text](url)   → text run with link mark (href=url)
//   **text**      → text run with bold mark
//   *text*        → text run with italic mark
// Markdown ATX headings (### / ## / #) that leaked into a paragraph
// are detected at line level and promoted to heading nodes.

import type { DraftOutput, DraftSection } from './types';

// Reconstructs a DraftOutput from a stored article so we can re-run
// deterministic QA + body_rich conversion without the original
// pipeline state. Used by the admin preview page's "re-run QA on the
// existing paid draft" path. The markdown body is split on blank
// lines; any block starting with "#" opens a new section with that
// heading, everything else becomes a paragraph in the current
// section. Internal links / images are not recovered — those were
// already enforced by the first QA pass and are in body_rich if the
// writer wants them.
export function reconstructDraftFromArticle(a: {
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  slug: string;
  featured_image_url: string | null;
  body: string | null;
}): DraftOutput {
  const sections: DraftSection[] = [];
  const text = a.body ?? '';
  let current: DraftSection = { id: 'intro', heading: null, heading_level: null, paragraphs: [], internal_links: [], images: [] };
  let counter = 1;
  const blocks = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const block of blocks) {
    const hm = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(block);
    if (hm) {
      if (current.paragraphs.length > 0 || current.heading) sections.push(current);
      counter += 1;
      const level = Math.min(3, Math.max(1, hm[1]!.length)) as 1 | 2 | 3;
      current = {
        id: `section_${counter}`,
        heading: hm[2]!.trim(),
        heading_level: level,
        paragraphs: [],
        internal_links: [],
        images: [],
      };
    } else {
      current.paragraphs.push(block);
    }
  }
  if (current.paragraphs.length > 0 || current.heading) sections.push(current);
  if (sections.length === 0) sections.push(current);
  return {
    title: a.title,
    meta_title: a.meta_title ?? a.title,
    meta_description: a.meta_description ?? '',
    slug: a.slug,
    featured_image_source_url: a.featured_image_url ?? null,
    sections,
  };
}

export interface TiptapDoc {
  type: 'doc';
  content: TiptapNode[];
}
export type TiptapNode =
  | { type: 'paragraph'; content?: TiptapInline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 }; content: TiptapInline[] }
  | { type: 'image'; attrs: { src: string; alt?: string; title?: string } };
export type TiptapMark =
  | { type: 'link'; attrs: { href: string } }
  | { type: 'bold' }
  | { type: 'italic' };
export type TiptapInline =
  | { type: 'text'; text: string; marks?: TiptapMark[] };

export function draftToBodyRich(draft: DraftOutput): TiptapDoc {
  const content: TiptapNode[] = [];
  for (const section of draft.sections) {
    // H1 is reserved for the rendering layer (page template). Any
    // heading from the draft becomes H2 or H3.
    if (section.heading && section.heading_level && section.heading_level !== 1) {
      content.push({
        type: 'heading',
        attrs: { level: section.heading_level === 3 ? 3 : 2 },
        content: [{ type: 'text', text: section.heading.trim() }],
      });
    }
    for (const p of section.paragraphs) {
      pushParagraph(content, p, section.internal_links);
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

// A paragraph string may contain:
//   1. One or more lines, some of which are ATX markdown headings.
//   2. Inline markdown: ![alt](url), [text](url), **bold**, *italic*.
// Headings must be promoted to top-level heading nodes. Image markdown
// becomes a top-level image node (and splits the paragraph into text
// around it). Everything else forms paragraph(s) with inline marks.
function pushParagraph(
  content: TiptapNode[],
  paragraph: string,
  links: Array<{ anchor: string; target_url: string }>,
): void {
  const trimmed = paragraph.trim();
  if (!trimmed) return;

  // Split on blank lines first so a run of \n\n in the paragraph
  // string produces separate paragraph nodes.
  const blocks = trimmed.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split(/\n/);
    // Each line may be a heading or part of a paragraph. We buffer
    // paragraph lines together and flush when a heading appears.
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const text = buffer.join(' ').replace(/\s{2,}/g, ' ').trim();
      buffer = [];
      if (!text) return;
      splitByImage(text, links, content);
    };
    for (const line of lines) {
      const m = /^(\s{0,3})(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (m) {
        flush();
        const level = Math.min(3, Math.max(2, m[2]!.length)) as 2 | 3;
        content.push({
          type: 'heading',
          attrs: { level },
          content: toInline(m[3]!, links),
        });
      } else {
        buffer.push(line);
      }
    }
    flush();
  }
}

// If the text contains ![alt](url), split it into text-before, image,
// text-after at each occurrence. Each text run becomes a paragraph
// node; each image becomes an image node.
function splitByImage(
  text: string,
  links: Array<{ anchor: string; target_url: string }>,
  content: TiptapNode[],
): void {
  const IMG_RE = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = IMG_RE.exec(text)) != null) {
    const before = text.slice(last, m.index).trim();
    if (before) {
      const inline = toInline(before, links);
      if (inline.length > 0) content.push({ type: 'paragraph', content: inline });
    }
    content.push({
      type: 'image',
      attrs: { src: m[2]!, alt: (m[1] ?? '').trim() },
    });
    last = m.index + m[0].length;
  }
  const tail = text.slice(last).trim();
  if (tail) {
    const inline = toInline(tail, links);
    if (inline.length > 0) content.push({ type: 'paragraph', content: inline });
  } else if (last === 0) {
    // No image match — toInline a plain paragraph.
    const inline = toInline(text, links);
    if (inline.length > 0) content.push({ type: 'paragraph', content: inline });
  }
}

// Convert plain-ish text + known internal links into inline nodes.
// Handles [text](url), **bold**, *italic* markdown first; whatever
// remains plain text gets scanned for anchor substrings so natural
// phrases picked up by the internal-link engine become link marks.
function toInline(
  text: string,
  links: Array<{ anchor: string; target_url: string }>,
): TiptapInline[] {
  if (!text) return [];

  // ─── Pass 1: parse inline markdown linearly, producing a mixed
  //              list of text runs with marks and plain-text runs.
  type Run = { text: string; marks: TiptapMark[]; parsed: boolean };
  const LINK_RE = /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/;
  const BOLD_RE = /\*\*([^*\n]+)\*\*/;
  const ITAL_RE = /(?<!\*)\*([^*\n]+)\*(?!\*)/;

  const runs: Run[] = [{ text, marks: [], parsed: false }];
  const consumeMarkdown = (re: RegExp, markFactory: (m: RegExpExecArray) => TiptapMark): void => {
    for (let i = 0; i < runs.length; i++) {
      const run = runs[i]!;
      if (run.parsed) continue;
      const m = re.exec(run.text);
      if (!m) continue;
      const before = run.text.slice(0, m.index);
      const after  = run.text.slice(m.index + m[0].length);
      const inner  = m[1] ?? '';
      const marks  = run.marks.concat(markFactory(m));
      const next: Run[] = [];
      if (before) next.push({ text: before, marks: run.marks, parsed: false });
      if (inner)  next.push({ text: inner, marks, parsed: true });   // parsed so we don't re-match the inner
      if (after)  next.push({ text: after, marks: run.marks, parsed: false });
      runs.splice(i, 1, ...next);
      i = i - 1 + next.length;  // re-process newly inserted runs
    }
  };
  consumeMarkdown(LINK_RE, (m) => ({ type: 'link', attrs: { href: m[2]! } }));
  consumeMarkdown(BOLD_RE, () => ({ type: 'bold' }));
  consumeMarkdown(ITAL_RE, () => ({ type: 'italic' }));

  // ─── Pass 2: for every still-plain-text run (no existing marks),
  //              scan for anchor substrings and apply link marks.
  const anchors = links
    .filter((l) => l.anchor && l.target_url)
    .sort((a, b) => b.anchor.length - a.anchor.length);

  const expanded: Run[] = [];
  for (const run of runs) {
    const hasLink = run.marks.some((mk) => mk.type === 'link');
    if (hasLink || anchors.length === 0) {
      expanded.push(run);
      continue;
    }
    let cursor = 0;
    while (cursor < run.text.length) {
      let matched: { anchor: string; url: string; index: number } | null = null;
      for (const a of anchors) {
        const i = run.text.indexOf(a.anchor, cursor);
        if (i !== -1 && (matched == null || i < matched.index)) {
          matched = { anchor: a.anchor, url: a.target_url, index: i };
        }
      }
      if (!matched) {
        expanded.push({ text: run.text.slice(cursor), marks: run.marks, parsed: run.parsed });
        break;
      }
      if (matched.index > cursor) {
        expanded.push({ text: run.text.slice(cursor, matched.index), marks: run.marks, parsed: run.parsed });
      }
      expanded.push({
        text: matched.anchor,
        marks: run.marks.concat({ type: 'link', attrs: { href: matched.url } }),
        parsed: true,
      });
      cursor = matched.index + matched.anchor.length;
    }
  }

  // Emit as TiptapInline[], dropping empties.
  const out: TiptapInline[] = [];
  for (const r of expanded) {
    if (!r.text) continue;
    const node: TiptapInline = { type: 'text', text: r.text };
    if (r.marks.length > 0) node.marks = r.marks;
    out.push(node);
  }
  return out;
}
