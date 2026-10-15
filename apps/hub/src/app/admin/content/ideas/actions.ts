'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { generateIdeasForSite } from '@/server/content/ideas';
import { generateBriefForIdea } from '@/server/content/briefs';
import { driveDraftingFromIdea } from '@/server/content/pipeline';

// Generate ideas for all 5 active sites. Deterministic, no AI.
export async function regenerateAllIdeasAction(): Promise<{
  ok: boolean;
  perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number; shortfall?: number }>;
  totalShortfall: number;
}> {
  await requireAdmin('/admin/content/ideas');
  const sb = createServiceRoleSupabase();
  const { data: sites } = await sb.from('network_sites').select('id, slug').eq('status', 'active');
  const perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number; shortfall?: number }> = [];
  for (const s of ((sites ?? []) as Array<{ id: string; slug: string }>)) {
    try {
      const r = await generateIdeasForSite(sb, s.id, s.slug);
      perSite.push({ site: s.slug, generated: r.generated, refreshed: r.refreshed, dismissed_stale: r.dismissed_stale, shortfall: r.shortfall });
    } catch (err) {
      perSite.push({ site: s.slug, generated: 0, refreshed: 0, dismissed_stale: 0 });
      console.error(`[ideas] regen for ${s.slug}: ${(err as Error).message}`);
    }
  }
  const totalShortfall = perSite.reduce((a, r) => a + (r.shortfall ?? 0), 0);
  revalidatePath('/admin/content/ideas');
  revalidatePath('/admin/content');
  return { ok: true, perSite, totalShortfall };
}

export async function createManualIdeaAction(fd: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/content/ideas/new');
  const siteId = fd.get('siteId') as string;
  const title = (fd.get('title') as string).slice(0, 180);
  const contentType = fd.get('contentType') as string;
  const primaryQuery = (fd.get('primaryQuery') as string) || null;
  const summary = (fd.get('summary') as string) || null;
  const priority = (fd.get('priority') as string) || 'normal';
  const dedupe = `manual:${slugify(title)}`;
  const { error } = await sb.from('network_content_ideas').insert({
    site_id: siteId, content_type: contentType, working_title: title,
    primary_query: primaryQuery, summary, priority,
    status: 'new', origin_type: 'manual', origin_id: null,
    evidence: { source: 'manual_admin_entry' }, dedupe_key: dedupe,
    created_by: admin.adminRowId,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/admin/content/ideas');
  redirect('/admin/content/ideas');
}

export async function dismissIdeaAction(id: string, reason: string): Promise<void> {
  const { sb } = await requireAdmin('/admin/content/ideas');
  await sb.from('network_content_ideas').update({ status: 'dismissed', dismissed_at: new Date().toISOString(), dismiss_reason: reason.slice(0, 200) }).eq('id', id);
  revalidatePath('/admin/content/ideas');
}

export interface ApproveIdeaResult {
  ok: boolean;
  error?: string;
  pipeline?: 'drafted' | 'budget_waiting' | 'failed' | 'skipped';
  articleId?: string;
  message?: string;
}

export async function approveIdeaAction(id: string): Promise<ApproveIdeaResult> {
  const { admin, sb } = await requireAdmin('/admin/content/ideas');
  const { data: idea, error: loadErr } = await sb.from('network_content_ideas')
    .select('id, status, site_id').eq('id', id).maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!idea) return { ok: false, error: 'not found' };
  const row = idea as { id: string; status: string; site_id: string };
  if (row.status !== 'new') {
    return { ok: false, error: `cannot approve from status '${row.status}'` };
  }
  const { error } = await sb.from('network_content_ideas').update({
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: admin.adminRowId,
  }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await sb.rpc('network_log_audit', {
    p_action: 'idea.approved',
    p_entity_type: 'network_content_idea',
    p_entity_id: id,
    p_site_id: row.site_id,
    p_old_value: { status: row.status } as unknown as Record<string, unknown>,
    p_new_value: { status: 'approved' } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'manual',
    p_metadata: {} as unknown as Record<string, unknown>,
  });

  // Immediate single-click drafting: brief → article → draft → QC
  // in one server-action call. The idea page sets maxDuration=300
  // so Haiku 4.5 generation (~20-40 s) stays well within budget.
  // On budget denial, the idea is tagged 'budget_waiting' and the
  // weekly process-approved cron will pick it up when the rolling
  // window makes room.
  const outcome = await driveDraftingFromIdea(sb, id, admin.adminRowId);

  revalidatePath('/admin/content/ideas');
  revalidatePath('/admin/content');
  if (outcome.status === 'drafted' || outcome.status === 'skipped') {
    revalidatePath(`/admin/content/articles/${outcome.articleId}`);
  }

  switch (outcome.status) {
    case 'drafted':
      return { ok: true, pipeline: 'drafted', articleId: outcome.articleId, message: 'approved · drafted · ready to edit' };
    case 'skipped':
      return { ok: true, pipeline: 'skipped', articleId: outcome.articleId, message: `approved · existing article kept (${outcome.reason.replace(/_/g, ' ')})` };
    case 'budget_waiting':
      return { ok: true, pipeline: 'budget_waiting', articleId: outcome.articleId, message: `approved · Budget Waiting — needs $${outcome.neededUsd.toFixed(2)}, $${outcome.availableUsd.toFixed(4)} available` };
    case 'failed':
      return { ok: true, pipeline: 'failed', articleId: outcome.articleId, error: outcome.error, message: `approved · drafting failed: ${outcome.error}` };
  }
}

export async function updateIdeaAction(fd: FormData): Promise<void> {
  const { sb } = await requireAdmin('/admin/content/ideas');
  const id = fd.get('id') as string;
  const title = ((fd.get('title') as string) ?? '').slice(0, 180);
  const summary = ((fd.get('summary') as string) ?? '') || null;
  const primaryQuery = ((fd.get('primaryQuery') as string) ?? '') || null;
  const priority = (fd.get('priority') as string) || 'normal';
  const contentType = (fd.get('contentType') as string) || 'seo_article';
  const notes = ((fd.get('notes') as string) ?? '') || null;
  if (!id || !title) throw new Error('id + title required');
  const { error } = await sb.from('network_content_ideas').update({
    working_title: title,
    summary,
    primary_query: primaryQuery,
    priority,
    content_type: contentType,
    notes,
  }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/content/ideas');
  revalidatePath(`/admin/content/ideas/${id}`);
  redirect('/admin/content/ideas');
}

export async function generateBriefForIdeaAction(ideaId: string): Promise<{ ok: boolean; briefId?: string; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/content/ideas');
  try {
    const r = await generateBriefForIdea(sb, ideaId, admin.adminRowId);
    revalidatePath('/admin/content/ideas');
    revalidatePath('/admin/content/briefs');
    revalidatePath(`/admin/content/briefs/${r.briefId}`);
    return { ok: true, briefId: r.briefId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Server-side log so Vercel runtime captures the full detail. The
    // client-returned string is truncated.
    console.error(`[brief.generate] idea=${ideaId}: ${msg}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    return { ok: false, error: msg.slice(0, 500) };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}
