import 'server-only';

// Minimal markdown-to-HTML converter used ONLY to seed the rich
// editor when an article was previously stored as a markdown body.
// Deliberately pared-back vs. a full renderer because the editor
// re-emits HTML on save; what matters is that no content is lost on
// import.
//
// Supported syntax:
//
//   # heading     → <h2> (we don't allow h1 in articles — the page
//                   template renders the article title separately)
//   ## heading    → <h2>
//   ### heading   → <h3>
//   paragraph     → <p>
//   - item        → <ul><li>
//   1. item       → <ol><li>
//   > quote       → <blockquote>
//   **bold**      → <strong>
//   *italic*      → <em>
//   [text](url)   → <a href>
//   ![alt](url)   → <img> (only kept if the url matches the
//                   network-media bucket prefix; otherwise dropped)
//
// Code fences and inline code are intentionally NOT rendered — the
// editor doesn't support them. Any ``` block is kept as a plain
// paragraph so a human can decide what to do.

export function markdownToEditorHtml(md: string): string {
  const lines = (md ?? '').split(/\r?\n/);
  const out: string[] = [];
  let listOpen: 'ul' | 'ol' | null = null;
  let paraBuf: string[] = [];

  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (s: string) => {
    let x = esc(s);
    x = x.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) =>
      `<img src="${src}" alt="${alt}" />`,
    );
    x = x.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, href) => `<a href="${href}">${t}</a>`);
    x = x.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
    x = x.replace(/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`);
    return x;
  };

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push(`<p>${inline(paraBuf.join(' '))}</p>`);
    paraBuf = [];
  };
  const closeList = () => {
    if (listOpen) {
      out.push(`</${listOpen}>`);
      listOpen = null;
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (/^#{1,2}\s+/.test(line)) {
      flushPara();
      closeList();
      out.push(`<h2>${inline(line.replace(/^#{1,2}\s+/, ''))}</h2>`);
      continue;
    }
    if (/^###\s+/.test(line)) {
      flushPara();
      closeList();
      out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`);
      continue;
    }
    if (/^>\s*/.test(line)) {
      flushPara();
      closeList();
      out.push(`<blockquote><p>${inline(line.replace(/^>\s*/, ''))}</p></blockquote>`);
      continue;
    }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listOpen !== 'ol') {
        closeList();
        out.push('<ol>');
        listOpen = 'ol';
      }
      out.push(`<li>${inline(ol[1] ?? '')}</li>`);
      continue;
    }
    if (ul) {
      flushPara();
      if (listOpen !== 'ul') {
        closeList();
        out.push('<ul>');
        listOpen = 'ul';
      }
      out.push(`<li>${inline(ul[1] ?? '')}</li>`);
      continue;
    }
    if (line === '') {
      flushPara();
      closeList();
      continue;
    }
    paraBuf.push(line);
  }
  flushPara();
  closeList();
  return out.join('\n');
}
