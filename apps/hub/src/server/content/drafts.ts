import 'server-only';

// Draft orchestrator. Converts an approved brief into an article
// draft row and (optionally) runs the AI draft generator.
//
// Phase 3 keeps draft generation USER-initiated: creating the article
// row is one action, generating body copy via AI is another explicit
// click. This avoids blind bulk generation.

import type { SupabaseClient } from '@supabase/supabase-js';
import { generateDraft, logAiCost, type VoiceProfile, type GeneratedBrief } from './ai';

async function loadVoice(sb: SupabaseClient, siteId: string): Promise<VoiceProfile> {
  const { data, error } = await sb
    .from('network_voice_profiles')
    .select('audience, tone, terminology, content_emphasis, preferred_structure, balance, do_not, naming_rules, canonical_tag, example_openings')
    .eq('site_id', siteId).maybeSingle();
  if (error) throw new Error(`[drafts] voice: ${error.message}`);
  if (!data) throw new Error(`[drafts] no voice for site ${siteId}`);
  const row = data as unknown as VoiceProfile & { example_openings: unknown };
  return {
    audience: row.audience, tone: row.tone, terminology: row.terminology,
    content_emphasis: row.content_emphasis, preferred_structure: row.preferred_structure,
    balance: row.balance, do_not: row.do_not, naming_rules: row.naming_rules,
    canonical_tag: row.canonical_tag,
    example_openings: Array.isArray(row.example_openings) ? (row.example_openings as string[]) : [],
  };
}

const PUB_TARGET: Record<string, 'ygo_db' | 'onepiece_db' | 'lorcana_db' | 'pokeprices_external' | 'mtgprices_markdown'> = {
  pokemon: 'pokeprices_external',
  mtg: 'mtgprices_markdown',
  ygo: 'ygo_db',
  onepiece: 'onepiece_db',
  lorcana: 'lorcana_db',
};

/**
 * Create an empty article row from an approved brief. Does not call
 * AI. The article enters status='draft' with empty body — operator
 * decides whether to use "Generate draft" (AI) or write it by hand.
 */
export async function createArticleFromBrief(
  sb: SupabaseClient,
  briefId: string,
  adminId: string | null,
): Promise<{ articleId: string }> {
  const { data: brief, error } = await sb
    .from('network_content_briefs')
    .select('id, idea_id, site_id, content_type, payload, status, network_sites(slug)')
    .eq('id', briefId).maybeSingle();
  if (error) throw new Error(`[drafts] load brief: ${error.message}`);
  if (!brief) throw new Error('brief not found');
  const b = brief as unknown as {
    id: string; idea_id: string; site_id: string; content_type: string;
    payload: GeneratedBrief; status: string; network_sites: { slug: string };
  };
  if (b.status !== 'approved') {
    throw new Error('[drafts] brief must be approved before article creation');
  }

  const pub = PUB_TARGET[b.network_sites.slug];
  if (!pub) throw new Error(`[drafts] unsupported site: ${b.network_sites.slug}`);

  const workingTitle = b.payload.suggested_h1 || 'Untitled';
  const slug = slugify(workingTitle);

  const { data: inserted, error: insErr } = await sb
    .from('network_articles')
    .insert({
      site_id: b.site_id,
      idea_id: b.idea_id,
      brief_id: b.id,
      title: workingTitle,
      working_title: workingTitle,
      slug,
      status: 'draft',
      content_type: b.content_type,
      primary_query: b.payload.primary_query ?? null,
      secondary_queries: b.payload.secondary_queries ?? [],
      summary: b.payload.purpose ?? null,
      body: '',
      body_format: 'markdown',
      meta_title: b.payload.suggested_meta_title ?? null,
      meta_description: b.payload.suggested_meta_description ?? null,
      author: 'Collector Network',
      publication_target: pub,
      created_by: adminId,
    })
    .select('id').single();
  if (insErr) throw new Error(`[drafts] insert article: ${insErr.message}`);
  const articleId = (inserted as { id: string }).id;

  // Flip idea status
  await sb.from('network_content_ideas').update({ status: 'drafting' }).eq('id', b.idea_id);

  // Seed internal-link suggestions from the brief
  const linkRows = (b.payload.suggested_internal_links ?? []).map((l) => ({
    article_id: articleId,
    target_url: l.target_url,
    anchor_text: l.anchor,
    reason: l.reason,
    state: 'suggested' as const,
  }));
  if (linkRows.length > 0) {
    await sb.from('network_article_links').insert(linkRows);
  }

  // Initial version snapshot
  await sb.rpc('network_snapshot_article', {
    p_article_id: articleId,
    p_actor_type: 'system',
    p_actor_user_id: adminId,
    p_change_note: 'article created from approved brief',
  });

  await sb.rpc('network_log_audit', {
    p_action: 'article.created_from_brief',
    p_entity_type: 'network_article',
    p_entity_id: articleId,
    p_site_id: b.site_id,
    p_old_value: null,
    p_new_value: { brief_id: b.id, idea_id: b.idea_id, slug } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'manual',
    p_metadata: {} as unknown as Record<string, unknown>,
  });

  return { articleId };
}

/**
 * Run the AI draft generator against the article's approved brief
 * and persist the generated body. Previous body (if any) is kept via
 * network_snapshot_article before overwrite.
 */
export async function generateArticleDraft(
  sb: SupabaseClient,
  articleId: string,
  adminId: string | null,
): Promise<{ draft: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number; est_cost_usd: number; model: string } }> {
  const { data: art, error } = await sb
    .from('network_articles')
    .select('id, site_id, brief_id, title, slug, body, publication_target, network_sites(slug)')
    .eq('id', articleId).maybeSingle();
  if (error) throw new Error(`[drafts] load article: ${error.message}`);
  if (!art) throw new Error('article not found');
  const a = art as unknown as { id: string; site_id: string; brief_id: string; title: string; slug: string; body: string; publication_target: string; network_sites: { slug: string } };
  if (!a.brief_id) throw new Error('article has no attached brief');

  // Snapshot current state before overwrite
  if (a.body && a.body.length > 0) {
    await sb.rpc('network_snapshot_article', {
      p_article_id: a.id,
      p_actor_type: 'system',
      p_actor_user_id: adminId,
      p_change_note: 'pre-AI-regeneration snapshot',
    });
  }

  const { data: brief } = await sb
    .from('network_content_briefs')
    .select('id, payload').eq('id', a.brief_id).maybeSingle();
  if (!brief) throw new Error('brief not found');
  const briefPayload = (brief as { payload: GeneratedBrief }).payload;

  const voice = await loadVoice(sb, a.site_id);

  // Internal links already attached. "accepted" entries carry
  // operator-approved anchors; else fall back to suggested.
  const { data: links } = await sb
    .from('network_article_links')
    .select('target_url, anchor_text, reason, state')
    .eq('article_id', a.id);
  const linkSlate = ((links ?? []) as Array<{ target_url: string; anchor_text: string | null; reason: string | null; state: string }>)
    .filter((l) => l.state === 'accepted' || l.state === 'suggested')
    .map((l) => ({
      target_url: l.target_url,
      anchor: l.anchor_text ?? '',
      reason: l.reason ?? '',
      accepted: l.state === 'accepted',
    }));

  const { draft, usage, rawText } = await generateDraft({
    siteSlug: a.network_sites.slug,
    voice,
    brief: briefPayload,
    internal_link_slate: linkSlate.map((l) => ({ ...l })),
  });

  await sb.from('network_articles').update({
    title: draft.title,
    slug: draft.slug.length > 0 ? draft.slug : a.slug,
    body: draft.body_markdown,
    body_format: 'markdown',
    meta_title: draft.meta_title,
    meta_description: draft.meta_description,
    summary: draft.summary,
  }).eq('id', a.id);

  // Append sources from the AI output
  if ((draft.sources ?? []).length > 0) {
    const sourceRows = draft.sources.map((s) => ({
      article_id: a.id,
      source_type: 'editorial' as const,
      source_name: s.source,
      claim_scope: s.claim,
    }));
    await sb.from('network_article_sources').insert(sourceRows);
  }

  await sb.rpc('network_snapshot_article', {
    p_article_id: a.id,
    p_actor_type: 'ai',
    p_actor_user_id: adminId,
    p_change_note: `AI draft generated (${usage.model}, ${usage.input_tokens} in / ${usage.output_tokens} out, est $${usage.est_cost_usd.toFixed(4)})`,
  });

  await logAiCost(sb, {
    operation: 'draft', usage,
    article_id: a.id, brief_id: a.brief_id,
    actor_user_id: adminId ?? undefined,
  });

  await sb.rpc('network_log_audit', {
    p_action: 'article.ai_draft_generated',
    p_entity_type: 'network_article',
    p_entity_id: a.id,
    p_site_id: a.site_id,
    p_old_value: null,
    p_new_value: { model: usage.model, cost_usd: usage.est_cost_usd, body_chars: draft.body_markdown.length } as unknown as Record<string, unknown>,
    p_actor_type: 'ai',
    p_source: 'ai_claude',
    p_metadata: { raw_chars: rawText.length, research_gaps: draft.research_gaps } as unknown as Record<string, unknown>,
  });

  return { draft: draft as unknown as Record<string, unknown>, usage };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// =============================================================
// Deterministic QC checks
// =============================================================

export interface QcIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export async function runArticleQc(
  sb: SupabaseClient,
  articleId: string,
): Promise<QcIssue[]> {
  const { data: art } = await sb
    .from('network_articles')
    .select('id, site_id, title, slug, body, body_format, meta_title, meta_description, publication_target')
    .eq('id', articleId).maybeSingle();
  if (!art) return [{ code: 'not_found', severity: 'error', message: 'article not found' }];
  const a = art as { id: string; site_id: string; title: string; slug: string; body: string; body_format: string; meta_title: string | null; meta_description: string | null; publication_target: string };
  const issues: QcIssue[] = [];

  if (!a.title) issues.push({ code: 'title_missing', severity: 'error', message: 'Title is required.' });
  if (!a.slug) issues.push({ code: 'slug_missing', severity: 'error', message: 'Slug is required.' });
  if (!a.meta_title) issues.push({ code: 'meta_title_missing', severity: 'warning', message: 'Meta title is empty.' });
  else if (a.meta_title.length > 65) issues.push({ code: 'meta_title_long', severity: 'warning', message: `Meta title ${a.meta_title.length} chars — recommended ≤60.` });
  if (!a.meta_description) issues.push({ code: 'meta_description_missing', severity: 'warning', message: 'Meta description is empty.' });
  else if (a.meta_description.length > 170) issues.push({ code: 'meta_description_long', severity: 'warning', message: `Meta description ${a.meta_description.length} chars — recommended ≤160.` });

  // Duplicate slug across the same site
  const { data: dup } = await sb
    .from('network_articles')
    .select('id').eq('site_id', a.site_id).eq('slug', a.slug).neq('id', a.id).limit(1);
  if ((dup ?? []).length > 0) issues.push({ code: 'slug_duplicate', severity: 'error', message: 'Another article on this site shares this slug.' });

  // Body checks
  const body = a.body ?? '';
  if (body.trim().length === 0) {
    issues.push({ code: 'body_empty', severity: 'error', message: 'Article body is empty.' });
  } else {
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < 300) issues.push({ code: 'body_short', severity: 'warning', message: `Article is ${words} words — thin content risk.` });
    const h1Count = (body.match(/^#\s+/gm) ?? []).length;
    if (h1Count === 0) issues.push({ code: 'h1_missing', severity: 'warning', message: 'No H1 (#) found in body.' });
    if (h1Count > 1) issues.push({ code: 'h1_multiple', severity: 'warning', message: `Multiple H1 headers (${h1Count}) — only one is recommended.` });
    const h2Count = (body.match(/^##\s+/gm) ?? []).length;
    if (h2Count === 0) issues.push({ code: 'h2_missing', severity: 'warning', message: 'No H2 sections — flat articles risk weak information scent.' });

    if (/\bRESEARCH REQUIRED\b/i.test(body)) {
      issues.push({ code: 'placeholder_research_required', severity: 'error', message: 'Body contains "RESEARCH REQUIRED" — resolve before publishing.' });
    }
    if (/\bTODO\b|\bTBD\b|\{\{.*?\}\}/i.test(body)) {
      issues.push({ code: 'placeholder_todo', severity: 'error', message: 'Body contains TODO / TBD / {{placeholder}} markers.' });
    }
  }

  // Cannibalisation warning: does the primary_query already have an
  // open cannibalisation finding on this site?
  const { data: cannibal } = await sb
    .from('network_cannibalization_findings')
    .select('id, query').eq('site_id', a.site_id).eq('status', 'open');
  const primaryQueries = ((cannibal ?? []) as Array<{ query: string }>).map((c) => c.query.toLowerCase());
  if (a.title && primaryQueries.some((q) => a.title.toLowerCase().includes(q))) {
    issues.push({ code: 'cannibal_overlap', severity: 'warning', message: 'Title overlaps with an open cannibalisation finding — may compete with existing pages.' });
  }

  // Persist QC into qc_report so the editor UI shows it.
  await sb.from('network_articles').update({
    qc_report: { issues, ran_at: new Date().toISOString() } as unknown as Record<string, unknown>,
  }).eq('id', a.id);

  return issues;
}
