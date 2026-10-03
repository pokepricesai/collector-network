'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { generateArticleDraft, runArticleQc } from '@/server/content/drafts';
import { publishArticle } from '@/server/content/publish';

export async function updateArticleAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  const id = fd.get('id') as string;
  const update: Record<string, unknown> = {
    title: (fd.get('title') as string).slice(0, 300),
    slug: (fd.get('slug') as string).slice(0, 120),
    meta_title: ((fd.get('metaTitle') as string) || null)?.slice(0, 200) ?? null,
    meta_description: ((fd.get('metaDescription') as string) || null)?.slice(0, 400) ?? null,
    summary: ((fd.get('summary') as string) || null)?.slice(0, 400) ?? null,
    body: (fd.get('body') as string) || '',
  };
  const changeNote = (fd.get('changeNote') as string) || null;

  // Snapshot before overwrite
  await sb.rpc('network_snapshot_article', {
    p_article_id: id,
    p_actor_type: 'human',
    p_actor_user_id: admin.adminRowId,
    p_change_note: changeNote ?? 'manual edit',
  });

  const { error } = await sb.from('network_articles').update(update).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/content/articles/${id}`);
  return { ok: true };
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

export async function publishArticleAction(articleId: string, mode: 'preview' | 'publish'): Promise<{ ok: boolean; url?: string | null; requiresManual?: boolean; manualPayload?: unknown; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  try {
    const r = await publishArticle(sb, articleId, admin.adminRowId, mode);
    revalidatePath(`/admin/content/articles/${articleId}`);
    revalidatePath('/admin/content/articles');
    revalidatePath('/admin/content');
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, url: r.publicationUrl, requiresManual: r.requiresManualAction, manualPayload: r.manualPayload };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function toggleArticleLinkAction(linkId: string, state: 'suggested' | 'accepted' | 'rejected'): Promise<{ ok: boolean }> {
  const { sb } = await requireAdmin('/admin/content/articles');
  await sb.from('network_article_links').update({ state }).eq('id', linkId);
  return { ok: true };
}
