'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { generateArticleDraft, runArticleQc } from '@/server/content/drafts';
import { publishArticle, scheduleArticle, cancelSchedule } from '@/server/content/publish';
import { sanitiseEditorHtml } from '@/server/content/sanitise';
import { submitArticleToIndexNow, loadSiteIndexNow } from '@/server/content/indexing';

export async function updateArticleAction(fd: FormData): Promise<{ ok: boolean; error?: string; approvalInvalidated?: boolean; scheduleCancelled?: boolean }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const id = fd.get('id') as string;
  const changeNote = (fd.get('changeNote') as string) || null;

  const update: Record<string, unknown> = {
    title: (fd.get('title') as string).slice(0, 300),
    slug: (fd.get('slug') as string).slice(0, 120),
    meta_title: ((fd.get('metaTitle') as string) || null)?.slice(0, 200) ?? null,
    meta_description: ((fd.get('metaDescription') as string) || null)?.slice(0, 400) ?? null,
    summary: ((fd.get('summary') as string) || null)?.slice(0, 400) ?? null,
    standfirst: ((fd.get('standfirst') as string) || null)?.slice(0, 400) ?? null,
  };

  // Rich-text editor output flows through the server-side sanitiser
  // before persistence — the editor is NOT trusted to produce clean
  // HTML. The legacy markdown `body` column is left untouched so
  // AI-generated drafts remain available as a source of truth; the
  // public reader will prefer body_rich.html when present.
  const bodyHtmlRaw = fd.get('bodyRich');
  if (typeof bodyHtmlRaw === 'string') {
    const sanitised = sanitiseEditorHtml(bodyHtmlRaw);
    update['body_rich'] = sanitised as unknown as Record<string, unknown>;
    update['body_format'] = 'html';
  }

  // CN-05 OS Phase A.3 — approval invalidation on material edit.
  //
  // Read the current row's status + the current values of material
  // fields BEFORE overwriting. A material change on an article that
  // is already `approved` or `scheduled` means the human sign-off is
  // no longer valid for what's now in the row — flip it back to
  // `review` and cancel any pending schedule so the cron doesn't
  // publish an un-approved revision.
  //
  // Diff is value-based, not form-presence-based, so idempotent
  // re-saves of the same text don't drop sign-off. body_rich is
  // compared post-sanitisation so round-trip whitespace quirks
  // don't trigger false invalidations.
  const { data: pre } = await sb
    .from('network_articles')
    .select('id, status, scheduled_for, title, slug, meta_title, meta_description, summary, standfirst, body_rich, site_id')
    .eq('id', id)
    .maybeSingle();

  let approvalInvalidated = false;
  let scheduleCancelled = false;

  if (pre) {
    const previous = pre as {
      status: string | null; scheduled_for: string | null; site_id: string | null;
      title: string | null; slug: string | null;
      meta_title: string | null; meta_description: string | null;
      summary: string | null; standfirst: string | null;
      body_rich: Record<string, unknown> | null;
    };
    const needsReapproval =
      previous.status === 'approved' || previous.status === 'scheduled';
    if (needsReapproval) {
      const changed =
        update.title !== previous.title
        || update.slug !== previous.slug
        || update.meta_title !== previous.meta_title
        || update.meta_description !== previous.meta_description
        || update.summary !== previous.summary
        || update.standfirst !== previous.standfirst
        || (
          typeof bodyHtmlRaw === 'string'
          && JSON.stringify(update.body_rich ?? null) !== JSON.stringify(previous.body_rich ?? null)
        );
      if (changed) {
        update['status'] = 'review';
        if (previous.status === 'scheduled') {
          update['scheduled_for'] = null;
          update['scheduled_by'] = null;
          scheduleCancelled = true;
        }
        approvalInvalidated = true;
      }
    }
  }

  // Snapshot BEFORE overwrite — version history never silently
  // destroys prior content.
  await sb.rpc('network_snapshot_article', {
    p_article_id: id,
    p_actor_type: 'human',
    p_actor_user_id: admin.adminRowId,
    p_change_note: changeNote ?? 'manual edit',
  });

  const { error } = await sb.from('network_articles').update(update).eq('id', id);
  if (error) return { ok: false, error: error.message };

  // Audit the demotion so the article's history explains why the
  // sign-off was invalidated. We do this after the UPDATE succeeds
  // so a failed write doesn't leave orphaned audit entries.
  if (approvalInvalidated && pre) {
    const previous = pre as { status: string | null; site_id: string | null };
    await sb.rpc('network_log_audit', {
      p_action: 'article.approval_invalidated',
      p_entity_type: 'network_article',
      p_entity_id: id,
      p_site_id: previous.site_id ?? null,
      p_old_value: { status: previous.status } as unknown as Record<string, unknown>,
      p_new_value: {
        status: 'review',
        reason: 'material edit after approval',
        schedule_cancelled: scheduleCancelled,
      } as unknown as Record<string, unknown>,
      p_actor_type: 'human', p_source: 'manual',
      p_metadata: { actor: admin.email, change_note: changeNote } as unknown as Record<string, unknown>,
    });
  }

  revalidatePath(`/admin/content/articles/${id}`);
  if (approvalInvalidated) revalidatePath('/admin/content/articles');
  return { ok: true, approvalInvalidated, scheduleCancelled };
}

export async function generateDraftAction(articleId: string): Promise<{ ok: boolean; error?: string; cost?: number }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  try {
    const r = await generateArticleDraft(sb, articleId, admin.adminRowId);
    revalidatePath(`/admin/content/articles/${articleId}`);
    return { ok: true, cost: r.usage.est_cost_usd };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setArticleStatusAction(articleId: string, newStatus: 'draft' | 'review' | 'approved' | 'archived'): Promise<{ ok: boolean }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const update: Record<string, unknown> = { status: newStatus };
  await sb.from('network_articles').update(update).eq('id', articleId);
  await sb.rpc('network_log_audit', {
    p_action: `article.status.${newStatus}`,
    p_entity_type: 'network_article',
    p_entity_id: articleId, p_site_id: null,
    p_old_value: null, p_new_value: { status: newStatus } as unknown as Record<string, unknown>,
    p_actor_type: 'human', p_source: 'manual',
    p_metadata: { actor: admin.email } as unknown as Record<string, unknown>,
  });
  revalidatePath(`/admin/content/articles/${articleId}`);
  revalidatePath('/admin/content/articles');
  return { ok: true };
}

export async function runQcAction(articleId: string): Promise<{ ok: boolean; issues: Array<{ code: string; severity: string; message: string }> }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  const issues = await runArticleQc(sb, articleId);
  revalidatePath(`/admin/content/articles/${articleId}`);
  return { ok: true, issues };
}

export async function publishArticleAction(articleId: string, mode: 'preview' | 'publish'): Promise<{ ok: boolean; url?: string | null; requiresManual?: boolean; manualPayload?: unknown; error?: string; verified?: boolean; verificationError?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  try {
    const r = await publishArticle(sb, articleId, admin.adminRowId, mode);
    revalidatePath(`/admin/content/articles/${articleId}`);
    revalidatePath('/admin/content/articles');
    revalidatePath('/admin/content');
    if (!r.ok) return { ok: false, error: r.error, verified: r.verified, verificationError: r.verificationError };
    return { ok: true, url: r.publicationUrl, requiresManual: r.requiresManualAction, manualPayload: r.manualPayload, verified: r.verified, verificationError: r.verificationError };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleArticleLinkAction(linkId: string, state: 'suggested' | 'accepted' | 'rejected'): Promise<{ ok: boolean }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  await sb.from('network_article_links').update({ state }).eq('id', linkId);
  return { ok: true };
}

export async function scheduleArticleAction(articleId: string, scheduledForIso: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const r = await scheduleArticle(sb, { articleId, scheduledForIso, adminId: admin.adminRowId });
  revalidatePath(`/admin/content/articles/${articleId}`);
  revalidatePath('/admin/content/articles');
  return r;
}

export async function cancelScheduleAction(articleId: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const r = await cancelSchedule(sb, articleId, admin.adminRowId);
  revalidatePath(`/admin/content/articles/${articleId}`);
  revalidatePath('/admin/content/articles');
  return r;
}

export async function markGoogleIndexRequestedAction(articleId: string, requested: boolean): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const update: Record<string, unknown> = requested
    ? { google_index_requested_at: new Date().toISOString(), google_index_requested_by: admin.adminRowId }
    : { google_index_requested_at: null, google_index_requested_by: null };
  const { error } = await sb.from('network_articles').update(update).eq('id', articleId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/content/articles/${articleId}`);
  revalidatePath('/admin/content/indexing');
  return { ok: true };
}

export async function submitBingIndexNowAction(articleId: string): Promise<{ ok: boolean; status?: number; error?: string; skipped?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const { data: artRow } = await sb.from('network_articles')
    .select('site_id, publication_url').eq('id', articleId).maybeSingle();
  if (!artRow) return { ok: false, error: 'article not found' };
  const a = artRow as { site_id: string; publication_url: string | null };
  const site = await loadSiteIndexNow(sb, a.site_id);
  if (!site) return { ok: false, error: 'site config not found' };
  const r = await submitArticleToIndexNow({ url: a.publication_url, site });
  if (!r.skipped) {
    await sb.from('network_articles').update({
      bing_index_submitted_at: r.submittedAtIso,
      bing_index_submitted_by: admin.adminRowId,
      bing_index_submission_response: { ok: r.ok, status: r.status, error: r.error ?? null } as unknown as Record<string, unknown>,
    }).eq('id', articleId);
  }
  revalidatePath(`/admin/content/articles/${articleId}`);
  revalidatePath('/admin/content/indexing');
  return { ok: r.ok, status: r.status, skipped: r.skipped, error: r.error };
}
