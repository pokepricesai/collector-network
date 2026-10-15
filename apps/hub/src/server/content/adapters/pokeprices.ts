import 'server-only';

// PokePrices publishing adapter. Direct server-to-server write
// against the PokePrices Supabase project using its service-role
// key. The key never leaves the hub's server runtime (plain env
// var, no NEXT_PUBLIC_ prefix). See:
//   pokeprices-web/src/lib/insights/adminApi.ts   (column allowlist)
//   pokeprices-web/src/lib/insights/richText.ts   (block JSON shape)
//
// Writes the row with status='published' + published_at=now() so
// the public /insights/[slug] route (ISR revalidate=3600) picks it
// up on next request. We rely on the public URL check in
// server/content/publish.ts to confirm the row actually went live.

import { htmlToPokeBlocks, type PokeBlock } from './html-convert';

export interface PokepricesPublishInput {
  slug: string;
  headline: string;
  summary: string | null;
  bodyHtml: string;        // sanitised rich HTML (preferred)
  bodyMarkdownFallback: string | null; // used only if bodyHtml is empty
  metaTitle: string | null;
  metaDescription: string | null;
  author: string;
  publishedAtIso: string;  // ISO datetime
  heroImageUrl: string | null;
  primaryQuery: string | null;
}

export interface PokepricesPublishResult {
  ok: boolean;
  targetRecordId?: string;
  publicUrl?: string;
  error?: string;
  blocks: number;
}

const PUBLIC_INSIGHTS_BASE = 'https://www.pokeprices.io/insights';

export async function publishToPokePrices(input: PokepricesPublishInput): Promise<PokepricesPublishResult> {
  const url = process.env['POKEPRICES_SUPABASE_URL'];
  const serviceKey = process.env['POKEPRICES_SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !serviceKey) {
    return { ok: false, error: 'POKEPRICES_SUPABASE_URL + POKEPRICES_SUPABASE_SERVICE_ROLE_KEY must be set on the hub (server-only)', blocks: 0 };
  }

  // Convert operator-visible rich HTML to the exact block JSON the
  // PokePrices renderer walks. If the article still only has the AI
  // markdown source (operator didn't open the rich editor), we need
  // to convert that first — fallback to plain paragraph splitting.
  let blocks: PokeBlock[];
  if (input.bodyHtml.replace(/<[^>]+>/g, '').trim().length > 0) {
    blocks = htmlToPokeBlocks(input.bodyHtml);
  } else if (input.bodyMarkdownFallback && input.bodyMarkdownFallback.trim().length > 0) {
    blocks = markdownParagraphsToBlocks(input.bodyMarkdownFallback);
  } else {
    return { ok: false, error: 'article body is empty', blocks: 0 };
  }

  if (blocks.length === 0) {
    return { ok: false, error: 'converted body produced zero blocks', blocks: 0 };
  }

  // Payload matches PokePrices' WRITABLE_ARTICLE_COLUMNS allowlist.
  // seo_* and meta_* are dual-written per their mirrorSeoFields rule.
  const row: Record<string, unknown> = {
    slug: input.slug,
    headline: input.headline,
    intro: input.summary ?? null,
    body_json: blocks,
    status: 'published',
    published_at: input.publishedAtIso,
    author: input.author,
    seo_title: input.metaTitle,
    seo_description: input.metaDescription,
    meta_title: input.metaTitle,
    meta_description: input.metaDescription,
    read_time_mins: estimateReadingTimeMins(blocks),
  };
  if (input.heroImageUrl) row['image_url'] = input.heroImageUrl;

  // PostgREST upsert against (slug) so a republish for the same slug
  // updates in place rather than conflicting on the unique index.
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/insights?on_conflict=slug`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'public',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `PokePrices Supabase ${res.status}: ${body.slice(0, 300)}`, blocks: blocks.length };
  }
  const data = await res.json().catch(() => null);
  const inserted = Array.isArray(data) ? data[0] : data;
  const id = inserted && typeof inserted === 'object' ? String((inserted as Record<string, unknown>)['id'] ?? '') : '';

  return {
    ok: true,
    targetRecordId: id || undefined,
    publicUrl: `${PUBLIC_INSIGHTS_BASE}/${input.slug}`,
    blocks: blocks.length,
  };
}

function estimateReadingTimeMins(blocks: PokeBlock[]): number {
  let words = 0;
  for (const b of blocks) {
    if (b.type === 'heading') words += b.text.split(/\s+/).filter(Boolean).length;
    else if (b.type === 'paragraph') {
      for (const seg of b.content) words += seg.text.split(/\s+/).filter(Boolean).length;
    }
  }
  // ~230 words per minute, round up to the nearest minute, minimum 1.
  return Math.max(1, Math.ceil(words / 230));
}

function markdownParagraphsToBlocks(md: string): PokeBlock[] {
  const blocks: PokeBlock[] = [];
  const paragraphs = md.split(/\n\s*\n/);
  for (const p of paragraphs) {
    const t = p.trim();
    if (!t) continue;
    if (t.startsWith('## ')) { blocks.push({ type: 'heading', text: t.slice(3).trim() }); continue; }
    if (t.startsWith('### ')) { blocks.push({ type: 'heading', text: t.slice(4).trim() }); continue; }
    if (t.startsWith('# ')) { blocks.push({ type: 'heading', text: t.slice(2).trim() }); continue; }
    blocks.push({ type: 'paragraph', content: [{ text: t.replace(/\n/g, ' ') }] });
  }
  return blocks;
}
