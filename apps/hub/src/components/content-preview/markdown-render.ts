import 'server-only';

// Minimal markdown → HTML renderer used as a last-resort fallback when
// a legacy article has no body_rich. It is intentionally the same
// grammar as apps/yugioh/apps/onepiece/apps/lorcana ship, so the
// preview looks visually identical to a published row that still has
// a markdown body.
//
// For body_rich.html articles the preview uses that HTML directly;
// this file is only touched when body_rich is null.

export function renderMarkdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = (md ?? '').split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let listOpen: 'ul' | 'ol' | null = null;
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push('<p>' + inline(paraBuf.join(' ')) + '</p>');
    paraBuf = [];
  };
  const closeList = () => {
    if (listOpen) { out.push(`</${listOpen}>`); listOpen = null; }
  };
  function inline(s: string): string {
    let x = esc(s);
    x = x.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, href) => `<a href="${href}">${t}</a>`);
    x = x.replace(/`([^`]+)`/g, (_m, t) => `<code>${t}</code>`);
    x = x.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
    x = x.replace(/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`);
    return x;
  }
  for (const raw of lines) {
    if (/^```/.test(raw)) {
      flushPara(); closeList();
      if (!inCode) { out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(raw)); continue; }
    const line = raw.trimEnd();
    if (/^#\s+/.test(line))  { flushPara(); closeList(); out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`); continue; }
    if (/^##\s+/.test(line)) { flushPara(); closeList(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (/^###\s+/.test(line)){ flushPara(); closeList(); out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); continue; }
    const ol = line.match(/^\d+\.\s+(.*)$/); const ul = line.match(/^[-*]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (listOpen !== 'ol') { closeList(); out.push('<ol>'); listOpen = 'ol'; }
      out.push(`<li>${inline(ol[1] ?? '')}</li>`); continue;
    }
    if (ul) {
      flushPara();
      if (listOpen !== 'ul') { closeList(); out.push('<ul>'); listOpen = 'ul'; }
      out.push(`<li>${inline(ul[1] ?? '')}</li>`); continue;
    }
    if (line === '') { flushPara(); closeList(); continue; }
    paraBuf.push(line);
  }
  flushPara(); closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
