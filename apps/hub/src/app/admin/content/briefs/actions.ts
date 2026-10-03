'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { approveBrief, rejectBrief } from '@/server/content/briefs';
import { createArticleFromBrief } from '@/server/content/drafts';

export async function approveBriefAction(briefId: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/briefs');
  try {
    await approveBrief(sb, briefId, admin.adminRowId);
    revalidatePath('/admin/content/briefs');
    revalidatePath(`/admin/content/briefs/${briefId}`);
    revalidatePath('/admin/approvals');
    return { ok: true };
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function rejectBriefAction(briefId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/briefs');
  try {
    await rejectBrief(sb, briefId, admin.adminRowId, reason);
    revalidatePath('/admin/content/briefs');
    revalidatePath(`/admin/content/briefs/${briefId}`);
    return { ok: true };
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}

export async function createArticleFromBriefAction(briefId: string): Promise<{ ok: boolean; articleId?: string; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/briefs');
  try {
    const r = await createArticleFromBrief(sb, briefId, admin.adminRowId);
    revalidatePath('/admin/content/briefs');
    revalidatePath('/admin/content/articles');
    return { ok: true, articleId: r.articleId };
  } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
}
