'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import type { SiteSlug } from '@/server/intelligence/types';

// Minimal server actions for the Phase-1 task tracker. All writes
// go through here so the task shape stays consistent (task_source,
// task_kind, task_type always populated).

const SITE_SLUGS: SiteSlug[] = ['pokemon', 'mtg', 'ygo', 'onepiece', 'lorcana'];

function asSiteSlug(v: FormDataEntryValue | null): SiteSlug | null {
  if (typeof v !== 'string') return null;
  if (v === '' || v === 'network') return null;
  return (SITE_SLUGS as string[]).includes(v) ? (v as SiteSlug) : null;
}

function asKind(v: FormDataEntryValue | null): 'fix' | 'improvement' {
  return v === 'fix' ? 'fix' : 'improvement';
}

function asPriority(v: FormDataEntryValue | null): 'high' | 'normal' | 'low' {
  if (v === 'high' || v === 'low') return v;
  return 'normal';
}

export async function createManualTaskAction(formData: FormData): Promise<void> {
  const title = (formData.get('title') ?? '').toString().trim();
  if (!title) return;
  const kind = asKind(formData.get('task_kind'));
  const priority = asPriority(formData.get('priority'));
  const siteSlug = asSiteSlug(formData.get('site_slug'));
  const notes = (formData.get('notes') ?? '').toString().trim();

  const { sb, admin } = await requireAdmin('/admin/tasks');

  let site_id: string | null = null;
  if (siteSlug) {
    const { data } = await sb.from('network_sites').select('id').eq('slug', siteSlug).maybeSingle();
    site_id = (data as null | { id: string })?.id ?? null;
  }

  await sb.from('network_tasks').insert({
    site_id,
    title: title.slice(0, 240),
    description: notes || null,
    task_type: kind,              // 'fix' or 'improvement' doubles as a legacy task_type label for manual rows
    task_kind: kind,
    task_source: 'manual',
    priority,
    status: 'open',
    metadata: { created_by_admin: admin.adminRowId },
  });

  revalidatePath('/admin/tasks');
  revalidatePath('/admin');
  if (siteSlug) revalidatePath(`/admin/sites/${siteSlug}`);
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  const id = formData.get('task_id');
  if (typeof id !== 'string') return;
  const { sb } = await requireAdmin('/admin/tasks');
  await sb.from('network_tasks').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
  }).eq('id', id);
  revalidatePath('/admin/tasks');
  revalidatePath('/admin');
}

export async function reopenTaskAction(formData: FormData): Promise<void> {
  const id = formData.get('task_id');
  if (typeof id !== 'string') return;
  const { sb } = await requireAdmin('/admin/tasks');
  await sb.from('network_tasks').update({
    status: 'open',
    completed_at: null,
  }).eq('id', id);
  revalidatePath('/admin/tasks');
  revalidatePath('/admin');
}
