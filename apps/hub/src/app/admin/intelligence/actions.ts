'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/server/admin/require-admin';
import { runIntelligenceEngine } from '@/server/intelligence/engine';

// CN-05 OS UX fix — Create task now navigates the operator directly
// to the task detail page where Freeze Baseline + Generate Claude
// Code Prompt live. Failures surface as a readable notice on the
// Intelligence inbox instead of being swallowed by console.error.
//
// The server-side flow is:
//   1. Load the intel item (eq id). Missing → stale link; redirect
//      back with a notice so the operator can refresh.
//   2. Already-linked (item.task_id set) → open that task directly.
//   3. Existing open task carrying this intelligence_item_id →
//      backfill the link + open the existing task (prevents
//      duplicate siblings even when the inbox serves a stale item).
//   4. Insert a new task via the canonical network_tasks path.
//      Flip the intel item to task_created ONLY after the task
//      row exists. Then redirect to the task detail page.
//
// We use `redirect()` (which throws a NEXT_REDIRECT control flow
// signal); the trailing paths are unreachable on the happy path,
// which is why error-only branches sit above every redirect.

function errorRedirect(message: string): never {
  const qs = new URLSearchParams({ task_error: message }).toString();
  redirect(`/admin/intelligence?${qs}`);
}

export async function createTaskFromItemAction(formData: FormData): Promise<void> {
  const id = formData.get('item_id');
  if (typeof id !== 'string') errorRedirect('Missing intelligence item id — try again from the inbox.');
  const { sb, admin } = await requireAdmin('/admin/intelligence');

  const { data: itemRow, error: loadErr } = await sb
    .from('network_intelligence_items')
    .select('id, site_id, status, category, type, title, summary, recommended_action, evidence, source_type, source_id, source_key, impact_score, confidence_score, urgency_score, effort_score, priority_score, task_id')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) errorRedirect(`Could not load the intelligence item: ${loadErr.message}`);
  const item = itemRow as null | {
    id: string; site_id: string | null; status: string; category: string; type: string;
    title: string; summary: string; recommended_action: string;
    evidence: Record<string, unknown>; source_type: string; source_id: string | null; source_key: string;
    impact_score: number; confidence_score: number; urgency_score: number; effort_score: number; priority_score: number;
    task_id: string | null;
  };
  if (!item) errorRedirect('Intelligence item not found — the inbox may have refreshed. Reload and try again.');

  // Idempotency path 1: this item already has a task_id. Open it.
  if (item.task_id) {
    revalidatePath('/admin/intelligence');
    revalidatePath('/admin/tasks');
    redirect(`/admin/tasks/${item.task_id}`);
  }

  // Idempotency path 2: a prior Create task left an open task
  // carrying this intelligence_item_id in its evidence but the
  // intel item's task_id back-reference never got written (the
  // exact failure mode this fix addresses). Backfill the link and
  // open the existing task — never insert a sibling.
  const { data: existing } = await sb
    .from('network_tasks')
    .select('id, status')
    .contains('evidence', { intelligence_item_id: item.id })
    .in('status', ['open', 'in_progress', 'waiting'])
    .order('created_at', { ascending: false })
    .limit(1);
  const existingOpen = (existing ?? []) as Array<{ id: string; status: string }>;
  if (existingOpen.length > 0) {
    const existingId = existingOpen[0]!.id;
    await sb.from('network_intelligence_items').update({
      status: 'task_created',
      task_id: existingId,
    }).eq('id', item.id);
    revalidatePath('/admin/intelligence');
    revalidatePath('/admin/tasks');
    redirect(`/admin/tasks/${existingId}`);
  }

  // Priority band derived from the engine score.
  const taskPriority =
    item.priority_score >= 85 ? 'critical' :
    item.priority_score >= 70 ? 'high' :
    item.priority_score >= 45 ? 'normal' : 'low';

  const { data: insRow, error: insErr } = await sb
    .from('network_tasks')
    .insert({
      site_id: item.site_id,
      title: item.title.slice(0, 240),
      description: `${item.summary}\n\nRecommended action: ${item.recommended_action}`,
      task_type: 'intelligence',
      task_kind: 'improvement',
      task_source: 'intelligence',
      priority: taskPriority,
      status: 'open',
      recommended_action: item.recommended_action,
      evidence: {
        intelligence_item_id: item.id,
        intelligence_source_key: item.source_key,
        intelligence_source_type: item.source_type,
        intelligence_source_id: item.source_id,
        intelligence_category: item.category,
        intelligence_type: item.type,
        intelligence_priority_score: item.priority_score,
        snapshot_scores: {
          impact: item.impact_score,
          confidence: item.confidence_score,
          urgency: item.urgency_score,
          effort: item.effort_score,
          priority: item.priority_score,
        },
        upstream_evidence: item.evidence,
      },
      metadata: { created_by_intelligence: true, admin_id: admin.adminRowId },
    })
    .select('id')
    .single();
  if (insErr || !insRow) {
    errorRedirect(`Task creation failed: ${insErr?.message ?? 'no row returned'}. Opportunity remains actionable; try again.`);
  }
  const task_id = (insRow as { id: string }).id;

  // Flip the intel item ONLY after the task row exists. If this
  // update errors, the task still exists and the next click
  // follows the "existing task" backfill branch above, so no sibling
  // is created.
  await sb.from('network_intelligence_items').update({
    status: 'task_created',
    task_id,
  }).eq('id', item.id);

  revalidatePath('/admin/intelligence');
  revalidatePath('/admin/tasks');
  redirect(`/admin/tasks/${task_id}`);
}

// Snooze: 1 / 7 / 30 day options.
export async function snoozeItemAction(formData: FormData): Promise<void> {
  const id = formData.get('item_id');
  const days = formData.get('days');
  if (typeof id !== 'string') return;
  const n = Number(days);
  if (!Number.isFinite(n) || ![1, 7, 30].includes(n)) return;
  const { sb } = await requireAdmin('/admin/intelligence');
  const until = new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
  await sb.from('network_intelligence_items').update({
    status: 'snoozed',
    snoozed_until: until,
  }).eq('id', id);
  revalidatePath('/admin/intelligence');
}

// Dismiss: preserve audit, capture priority snapshot so the engine
// can decide later whether to re-open.
export async function dismissItemAction(formData: FormData): Promise<void> {
  const id = formData.get('item_id');
  if (typeof id !== 'string') return;
  const { sb, admin } = await requireAdmin('/admin/intelligence');

  const { data } = await sb
    .from('network_intelligence_items')
    .select('priority_score')
    .eq('id', id)
    .maybeSingle();
  const prior = ((data as null | { priority_score: number })?.priority_score) ?? 0;

  await sb.from('network_intelligence_items').update({
    status: 'dismissed',
    dismissed_at: new Date().toISOString(),
    dismissed_by: admin.adminRowId,
    dismissed_priority: prior,
  }).eq('id', id);
  revalidatePath('/admin/intelligence');
}

// Resolve: operator explicitly closes the item (not auto-resolved).
export async function resolveItemAction(formData: FormData): Promise<void> {
  const id = formData.get('item_id');
  if (typeof id !== 'string') return;
  const { sb } = await requireAdmin('/admin/intelligence');
  await sb.from('network_intelligence_items').update({
    status: 'resolved',
    resolved_at: new Date().toISOString(),
    resolved_reason: 'operator_closed',
  }).eq('id', id);
  revalidatePath('/admin/intelligence');
}

// Manual engine run from the admin UI. Writes to the DB but makes
// NO external calls, NO AI calls, NO budget spend.
export async function refreshIntelligenceAction(): Promise<void> {
  const { sb } = await requireAdmin('/admin/intelligence');
  await runIntelligenceEngine(sb);
  revalidatePath('/admin/intelligence');
}
