import 'server-only';

// Phase 3 fallback. The hardcoded YGO_ARTICLES registry carries the
// launch articles that have bespoke React bodies in page.tsx. When a
// slug isn't in that registry, this helper reads a published
// Collector Network OS article from network_articles via the shared
// Supabase project. Markdown body is rendered as plain HTML with
// basic transforms — no react-markdown dependency needed to keep
// the public site slim.
//
// Only articles with publication_target='ygo_db' AND status='published'
// are returned. The row-level security policy on network_articles
// permits anonymous reads for exactly that shape.

import { createClient } from '@supabase/supabase-js';

const SB_URL = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
const SB_ANON = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'];

function anonClient() {
  if (!SB_URL || !SB_ANON) throw new Error('[network-articles] Supabase env missing');
  return createClient(SB_URL, SB_ANON, { auth: { persistSession: false } });
}

export interface NetworkArticle {
  slug: string;
  title: string;
  summary: string | null;
  bodyMarkdown: string;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: string | null;
  updatedAt: string;
  author: string;
}

export async function findNetworkArticle(slug: string): Promise<NetworkArticle | null> {
  try {
    const sb = anonClient();
    const { data } = await sb
      .from('network_articles')
      .select('title, slug, summary, body, body_format, meta_title, meta_description, published_at, updated_at, author')
      .eq('slug', slug).eq('status', 'published').eq('publication_target', 'ygo_db').maybeSingle();
    if (!data) return null;
    const r = data as unknown as {
      title: string; slug: string; summary: string | null; body: string; body_format: string;
      meta_title: string | null; meta_description: string | null;
      published_at: string | null; updated_at: string; author: string;
    };
    return {
      slug: r.slug, title: r.title, summary: r.summary,
      bodyMarkdown: r.body, metaTitle: r.meta_title, metaDescription: r.meta_description,
      publishedAt: r.published_at, updatedAt: r.updated_at, author: r.author,
    };
  } catch { return null; }
}

export async function listNetworkArticles(): Promise<Array<Pick<NetworkArticle, 'slug' | 'title' | 'summary' | 'publishedAt' | 'updatedAt'>>> {
  try {
    const sb = anonClient();
    const { data } = await sb
      .from('network_articles')
      .select('slug, title, summary, published_at, updated_at')
      .eq('status', 'published').eq('publication_target', 'ygo_db')
      .order('published_at', { ascending: false });
    return ((data ?? []) as unknown as Array<{ slug: string; title: string; summary: string | null; published_at: string | null; updated_at: string }>)
      .map((r) => ({ slug: r.slug, title: r.title, summary: r.summary, publishedAt: r.published_at, updatedAt: r.updated_at }));
  } catch { return []; }
}

/** Lightweight markdown → HTML. No external dependency to keep the
 *  public bundle small. Handles headings, paragraphs, bold, italics,
 *  inline code, code blocks, lists, and links. Not a full engine. */
export function renderMarkdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let listOpen: 'ul' | 'ol' | null = null;
  let paraBuf: string[] = [];
  const flushPara = () => {
    if (paraBuf.length === 0) return;
    out.push('<p>' + inline(paraBuf.join(' ')) + '</p>');
    paraBuf = [];
  };
  const closeList = () => { if (listOpen) { out.push(`</${listOpen}>`); listOpen = null; } };
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
      if (!inCode) { out.push('<pre><code>'); inCode = true; } else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(raw)); continue; }
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { flushPara(); closeList(); out.push(`<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`); continue; }
    if (/^##\s+/.test(line)) { flushPara(); closeList(); out.push(`<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (/^###\s+/.test(line)) { flushPara(); closeList(); out.push(`<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`); continue; }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ol) {
      flushPara(); if (listOpen !== 'ol') { closeList(); out.push('<ol>'); listOpen = 'ol'; }
      out.push(`<li>${inline(ol[1] ?? '')}</li>`); continue;
    }
    if (ul) {
      flushPara(); if (listOpen !== 'ul') { closeList(); out.push('<ul>'); listOpen = 'ul'; }
      out.push(`<li>${inline(ul[1] ?? '')}</li>`); continue;
    }
    if (line === '') { flushPara(); closeList(); continue; }
    paraBuf.push(line);
  }
  flushPara(); closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
