'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { createServiceRoleSupabase } from '@/server/admin/service-role';
import { generateIdeasForSite } from '@/server/content/ideas';
import { generateBriefForIdea } from '@/server/content/briefs';

// Generate ideas for all 5 active sites. Deterministic, no AI.
export async function regenerateAllIdeasAction(): Promise<{ ok: boolean; perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number }> }> {
  await requireAdmin('/admin/content/ideas');
  const sb = createServiceRoleSupabase();
  const { data: sites } = await sb.from('network_sites').select('id, slug').eq('status', 'active');
  const perSite: Array<{ site: string; generated: number; refreshed: number; dismissed_stale: number }> = [];
  for (const s of ((sites ?? []) as Array<{ id: string; slug: string }>)) {
    try {
      const r = await generateIdeasForSite(sb, s.id, s.slug);
      perSite.push({ site: s.slug, ...r });
    } catch (err) {
      perSite.push({ site: s.slug, generated: 0, refreshed: 0, dismissed_stale: 0 });
      console.error(`[ideas] regen for ${s.slug}: ${(err as Error).message}`);
    }
  }
  revalidatePath('/admin/content/ideas');
  revalidatePath('/admin/content');
  return { ok: true, perSite };
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
