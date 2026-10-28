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

  // task_type stays domain-neutral for manual rows. The existing
  // network_tasks writers use task_type as an automation routing
  // hint ('intelligence', 'commercial', 'internal_link',
  // 'seo_opportunity', 'seo_improve', 'seo_rewrite') and
  // content/routing.ts filters tasks via `.eq('task_type', ...)`.
  // Writing 'fix'/'improvement' into task_type would pollute that
  // vocabulary with values from a different (operator-facing)
  // classification. We keep task_type='manual' as the clean label
  // and let task_kind carry the fix/improvement distinction.
  await sb.from('network_tasks').insert({
    site_id,
    title: title.slice(0, 240),
    description: notes || null,
    task_type: 'manual',
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

  // Intelligence Quality Pass — when a task completes, flip the
  // linked intel item to `resolved` so it stops appearing in the
  // active inbox. We look up the task's evidence first to find the
  // intelligence_item_id back-reference (set by
  // createTaskFromItemAction when the task was created from intel).
  //
  // The next intelligence refresh will NOT reopen this item: the
  // engine only reopens items whose resolved_reason is
  // 'invalid_source_data' or whose dismiss priority delta is
  // crossed. A 'task_completed' resolution stays resolved unless
  // the operator explicitly reopens the task (which, below, also
  // reopens the intel item).
  const now = new Date().toISOString();
  const { data: task } = await sb.from('network_tasks')
    .select('evidence')
    .eq('id', id).maybeSingle();
  const intelId = (task?.evidence as { intelligence_item_id?: unknown } | null)?.intelligence_item_id;

  await sb.from('network_tasks').update({
    status: 'completed',
    completed_at: now,
  }).eq('id', id);

  if (typeof intelId === 'string' && intelId.length > 0) {
    // Only flip to resolved if currently task_created or open;
    // never clobber a dismissed/snoozed/already-resolved record.
    const { data: intel } = await sb.from('network_intelligence_items')
      .select('status').eq('id', intelId).maybeSingle();
    if (intel && (intel.status === 'task_created' || intel.status === 'open')) {
      await sb.from('network_intelligence_items').update({
        status: 'resolved',
        resolved_at: now,
        resolved_reason: 'task_completed',
      }).eq('id', intelId);
    }
  }

  revalidatePath('/admin/tasks');
  revalidatePath('/admin/intelligence');
  revalidatePath('/admin');
}

export async function reopenTaskAction(formData: FormData): Promise<void> {
  const id = formData.get('task_id');
  if (typeof id !== 'string') return;
  const { sb } = await requireAdmin('/admin/tasks');

  // Mirror of completeTaskAction: when the operator reopens a task,
  // reopen the linked intel item too so it reappears in the inbox
  // under the correct status.
  const { data: task } = await sb.from('network_tasks')
    .select('evidence')
    .eq('id', id).maybeSingle();
  const intelId = (task?.evidence as { intelligence_item_id?: unknown } | null)?.intelligence_item_id;

  await sb.from('network_tasks').update({
    status: 'open',
    completed_at: null,
  }).eq('id', id);

  if (typeof intelId === 'string' && intelId.length > 0) {
    // Only restore to task_created when currently resolved by task
    // completion. Resolved-for-other-reasons stays untouched.
    const { data: intel } = await sb.from('network_intelligence_items')
      .select('status, resolved_reason').eq('id', intelId).maybeSingle();
    if (intel && intel.status === 'resolved' && intel.resolved_reason === 'task_completed') {
      await sb.from('network_intelligence_items').update({
        status: 'task_created',
        resolved_at: null,
        resolved_reason: null,
      }).eq('id', intelId);
    }
  }

  revalidatePath('/admin/tasks');
  revalidatePath('/admin/intelligence');
  revalidatePath('/admin');
}
