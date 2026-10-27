'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { parseAndValidatePaste, markdownToTipTapHtml } from '@/server/claude/paste-import';
import { sanitiseEditorHtml } from '@/server/content/sanitise';
import { createArticleFromPaste } from '@/server/content/drafts';

// CN-05 OS Phase A.1 — paste-draft import.
//
// Accepts the structured JSON Claude Code returns from a writing-brief
// prompt, validates it, converts the Markdown body to TipTap-compatible
// HTML (through the server sanitiser), and creates a review-ready
// article draft via the canonical creation pathway. Redirects into
// the existing editor on success.

export interface ImportResult {
  ok: boolean;
  error?: string;
  path?: string;
  articleId?: string;
}

export async function importPastedDraftAction(fd: FormData): Promise<ImportResult> {
  const { admin, sb } = await requireAdmin('/admin/content/articles/import');

  const rawPaste = fd.get('paste');
  if (typeof rawPaste !== 'string' || rawPaste.trim().length === 0) {
    return { ok: false, error: 'paste the JSON output from Claude Code' };
  }

  const parsed = parseAndValidatePaste(rawPaste);
  if (!parsed.ok) return { ok: false, error: parsed.error, path: parsed.path };
  const draft = parsed.value;

  // Resolve site. Precedence:
  //   1. idea_id in the paste (preferred — carries site_id + content_type)
  //   2. idea_id selected on the form (overrides paste when operator picked one)
  //   3. explicit site_slug on the form (fallback for hand-written imports)
  const formIdeaId = fd.get('idea_id');
  const ideaIdFromForm = typeof formIdeaId === 'string' && formIdeaId.length > 0 ? formIdeaId : null;
  const ideaId = ideaIdFromForm ?? draft.idea_id ?? null;

  let siteId: string | null = null;
  let siteSlug: string | null = null;
  let contentType = 'seo_article';

  if (ideaId) {
    const { data: ideaRow } = await sb
      .from('network_content_ideas')
      .select('id, site_id, status, content_type, working_title, primary_query, secondary_queries, network_sites(slug)')
      .eq('id', ideaId).maybeSingle();
    if (!ideaRow) return { ok: false, error: `idea ${ideaId} not found`, path: 'idea_id' };
    const idea = ideaRow as unknown as {
      id: string; site_id: string; status: string; content_type: string;
      working_title: string; primary_query: string | null; secondary_queries: string[];
      network_sites: { slug: string };
    };
    if (idea.status !== 'approved' && idea.status !== 'drafting') {
      return { ok: false, error: `idea status is ${idea.status}; must be approved before import`, path: 'idea_id' };
    }
    siteId = idea.site_id;
    siteSlug = idea.network_sites.slug;
    contentType = idea.content_type;
  } else {
    const slugFromForm = fd.get('site_slug');
    if (typeof slugFromForm !== 'string' || slugFromForm.length === 0) {
      return { ok: false, error: 'select a site or an idea before importing', path: 'site_slug' };
    }
    const { data: siteRow } = await sb
      .from('network_sites')
      .select('id, slug')
      .eq('slug', slugFromForm).maybeSingle();
    if (!siteRow) return { ok: false, error: `site ${slugFromForm} not found`, path: 'site_slug' };
    siteId = (siteRow as { id: string }).id;
    siteSlug = (siteRow as { slug: string }).slug;
  }

  // Markdown → TipTap HTML, then run it through the SAME sanitiser the
  // editor uses on save. Non-allowlisted tags are stripped at the
  // sanitiser, so Claude cannot smuggle inline HTML past this gate
  // even if the Markdown walker misses it.
  const rawHtml = markdownToTipTapHtml(draft.body_markdown);
  const body_rich = sanitiseEditorHtml(rawHtml);
  if (!body_rich.html || body_rich.html.length < 20) {
    return { ok: false, error: 'converted body is empty — check the Markdown is not stripped by sanitising', path: 'body_markdown' };
  }

  let articleId: string;
  try {
    const r = await createArticleFromPaste(sb, {
      siteId: siteId!, siteSlug: siteSlug!, ideaId, contentType,
      adminId: admin.adminRowId,
      draft: {
        title: draft.title,
        slug: draft.slug ?? null,
        meta_title: draft.meta_title ?? null,
        meta_description: draft.meta_description ?? null,
        summary: draft.summary ?? null,
        standfirst: draft.standfirst ?? null,
        body_markdown: draft.body_markdown,
        body_rich,
        primary_query: null,
        secondary_queries: [],
        internal_links: draft.internal_links ?? [],
        sources: draft.sources ?? [],
        notes_for_editor: draft.notes_for_editor ?? null,
      },
    });
    articleId = r.articleId;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath('/admin/content/articles');
  redirect(`/admin/content/articles/${articleId}`);
}
