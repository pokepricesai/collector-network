'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';

export interface CreateChangeInput {
  siteId: string;
  changeType: string;
  title: string;
  description?: string;
  urlPattern?: string;
  url?: string;
  oldValue?: string;
  newValue?: string;
  commitSha?: string;
  status: 'proposed' | 'deployed' | 'measuring' | 'completed' | 'rolled_back' | 'cancelled';
  source?: string;
}

export async function createChangeAction(fd: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/seo/changes/new');
  const row = {
    site_id: fd.get('siteId') as string,
    change_type: fd.get('changeType') as string,
    title: (fd.get('title') as string).slice(0, 200),
    description: (fd.get('description') as string) || null,
    url_pattern: ((fd.get('urlPattern') as string) || null) || null,
    url: ((fd.get('url') as string) || null) || null,
    old_value: ((fd.get('oldValue') as string) || null) || null,
    new_value: ((fd.get('newValue') as string) || null) || null,
    commit_sha: ((fd.get('commitSha') as string) || null) || null,
    status: (fd.get('status') as string) || 'proposed',
    source: 'manual',
    actor: admin.email,
    actor_user_id: admin.adminRowId,
  };
  const { data, error } = await sb.from('network_seo_changes').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  const id = (data as { id: string }).id;
  await sb.rpc('network_log_audit', {
    p_action: 'seo_change.created',
    p_entity_type: 'network_seo_change',
    p_entity_id: id,
    p_site_id: row.site_id,
    p_old_value: null,
    p_new_value: row as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'manual',
    p_metadata: {} as unknown as Record<string, unknown>,
  });
  revalidatePath('/admin/seo/changes');
  redirect(`/admin/seo/changes/${id}`);
}

export async function updateChangeStatusAction(id: string, status: string): Promise<void> {
  const { sb } = await requireAdmin('/admin/seo/changes');
  const { error } = await sb.from('network_seo_changes').update({ status }).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/admin/seo/changes');
  revalidatePath(`/admin/seo/changes/${id}`);
}
