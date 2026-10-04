'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { generateSocialIdeasForAccount } from '@/server/social/ideas';
import { generatePostDraftFromIdea, approveSocialPost, cancelSocialPost, publishSocialPost } from '@/server/social/posts';
import { runEditorialQcForArticle } from '@/server/content/editorial-qc';
import { createRefreshIdeas } from '@/server/content/refresh';

export async function regenerateSocialIdeasAction(): Promise<{ ok: boolean; results: Array<{ account: string; generated: number; refreshed: number }> }> {
  await requireAdmin('/admin/social');
  const sb = createServiceRoleSupabase();
  const { data: accounts } = await sb.from('network_social_accounts').select('id, handle').eq('status', 'active');
  const results: Array<{ account: string; generated: number; refreshed: number }> = [];
  for (const a of ((accounts ?? []) as Array<{ id: string; handle: string }>)) {
    try {
      const r = await generateSocialIdeasForAccount(sb, a.id);
      results.push({ account: a.handle, generated: r.generated, refreshed: r.refreshed });
    } catch (err) {
      console.error(`[social-ideas] ${a.handle}: ${(err as Error).message}`);
      results.push({ account: a.handle, generated: 0, refreshed: 0 });
    }
  }
  revalidatePath('/admin/social');
  revalidatePath('/admin/social/ideas');
  return { ok: true, results };
}

export async function generatePostDraftAction(ideaId: string, wantThread: boolean): Promise<{ ok: boolean; postId?: string; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/social');
  try {
    const r = await generatePostDraftFromIdea(sb, ideaId, admin.adminRowId, { wantThread });
    revalidatePath('/admin/social');
    revalidatePath('/admin/social/ideas');
    revalidatePath('/admin/social/posts');
    revalidatePath(`/admin/social/posts/${r.postId}`);
    return { ok: true, postId: r.postId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[social-draft] ${msg}`);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

export async function updatePostAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/social');
  const id = fd.get('id') as string;
  const text = (fd.get('text') as string).slice(0, 280);
  const scheduledForRaw = (fd.get('scheduledFor') as string) || '';
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw).toISOString() : null;
  const change = (fd.get('changeNote') as string) || null;
  await sb.rpc('network_snapshot_social_post', {
    p_post_id: id, p_actor_type: 'human',
    p_actor_user_id: admin.adminRowId, p_change_note: change ?? 'manual edit',
  });
  const { error } = await sb.from('network_social_posts').update({
    text, scheduled_for: scheduledFor,
  }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/social/posts/${id}`);
  revalidatePath('/admin/social');
  return { ok: true };
}

export async function approvePostAction(postId: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/social');
  try {
    await approveSocialPost(sb, postId, admin.adminRowId);
    revalidatePath(`/admin/social/posts/${postId}`);
    revalidatePath('/admin/social');
    return { ok: true };
  } catch (err) { return { ok: false, error: (err as Error).message }; }
}

export async function cancelPostAction(postId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/social');
  try {
    await cancelSocialPost(sb, postId, admin.adminRowId, reason);
    revalidatePath(`/admin/social/posts/${postId}`);
    return { ok: true };
  } catch (err) { return { ok: false, error: (err as Error).message }; }
}

export async function publishPostAction(postId: string, mode: 'dry_run' | 'preview' | 'live'): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/social');
  try {
    const r = await publishSocialPost(sb, postId, admin.adminRowId, mode);
    revalidatePath(`/admin/social/posts/${postId}`);
    revalidatePath('/admin/social');
    return { ok: r.ok, result: r, error: r.error };
  } catch (err) { return { ok: false, error: (err as Error).message }; }
}

export async function runEditorialQcAction(articleId: string): Promise<{ ok: boolean; issue_count?: number; blockers?: number; warnings?: number; cost?: number; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/articles');
  try {
    const r = await runEditorialQcForArticle(sb, articleId, admin.adminRowId);
    revalidatePath(`/admin/content/articles/${articleId}`);
    return {
      ok: true,
      issue_count: r.issues.length,
      blockers: r.issues.filter((i) => i.severity === 'blocker').length,
      warnings: r.issues.filter((i) => i.severity === 'warning').length,
      cost: r.usage.est_cost_usd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[editorial-qc] ${msg}`);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

export async function regenerateRefreshIdeasAction(): Promise<{ ok: boolean; per_site: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number }> }> {
  await requireAdmin('/admin/content');
  const sb = createServiceRoleSupabase();
  const { data: sites } = await sb.from('network_sites').select('id, slug').eq('status', 'active');
  const perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number }> = [];
  for (const s of ((sites ?? []) as Array<{ id: string; slug: string }>)) {
    try {
      const r = await createRefreshIdeas(sb, s.id);
      perSite.push({ site: s.slug, ...r });
    } catch (err) {
      console.error(`[refresh] ${s.slug}: ${(err as Error).message}`);
      perSite.push({ site: s.slug, generated: 0, refreshed: 0, dismissed_stale: 0 });
    }
  }
  revalidatePath('/admin/content');
  revalidatePath('/admin/content/ideas');
  return { ok: true, per_site: perSite };
}

export async function createManualPostAction(fd: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/social/new');
  const accountId = fd.get('accountId') as string;
  const text = (fd.get('text') as string).slice(0, 280);
  const scheduledForRaw = (fd.get('scheduledFor') as string) || '';
  const scheduledFor = scheduledForRaw ? new Date(scheduledForRaw).toISOString() : null;
  const notes = (fd.get('notes') as string) || null;
  const { data } = await sb.from('network_social_posts').insert({
    account_id: accountId, idea_id: null, parent_post_id: null,
    thread_position: 0, post_type: 'manual', text,
    links: [], status: 'draft',
    scheduled_for: scheduledFor,
    actor_type: 'human',
    evidence: { source: 'manual_admin_entry', notes },
    created_by: admin.adminRowId,
  }).select('id').single();
  const postId = (data as { id: string } | null)?.id;
  if (postId) await sb.rpc('network_snapshot_social_post', { p_post_id: postId, p_actor_type: 'human', p_actor_user_id: admin.adminRowId, p_change_note: 'manual post created' });
  revalidatePath('/admin/social');
  if (postId) redirect(`/admin/social/posts/${postId}`);
}
