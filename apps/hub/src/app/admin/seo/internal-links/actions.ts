'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

export async function createTaskFromInternalLinkOpportunity(id: string): Promise<{ ok: boolean; taskId?: string; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/seo/internal-links');
  const { data, error } = await sb
    .from('network_internal_link_opportunities')
    .select('id, site_id, source_url, target_url, reason, relationship, priority, confidence, evidence, task_id, status')
    .eq('id', id)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not found' };
  const row = data as {
    id: string; site_id: string; source_url: string; target_url: string;
    reason: string; relationship: string | null; priority: 'critical' | 'high' | 'normal' | 'low';
    confidence: string; evidence: Record<string, unknown>; task_id: string | null; status: string;
  };
  if (row.task_id) return { ok: true, taskId: row.task_id };

  const taskRow = {
    site_id: row.site_id,
    title: `Add internal link (${row.reason.replace(/_/g, ' ')})`,
    description: `From: ${row.source_url}\nTo:   ${row.target_url}\nReason: ${row.reason}\nConfidence: ${row.confidence}`,
    task_type: 'internal_link',
    source_code: 'derived',
    priority: row.priority,
    status: 'open' as const,
    evidence: { opportunity_id: row.id, source_url: row.source_url, target_url: row.target_url, reason: row.reason, evidence: row.evidence },
    recommended_action: `Edit ${row.source_url} and add a contextual anchor to ${row.target_url}.`,
    assigned_to: admin.adminRowId,
    metadata: { kind: 'internal_link', reason: row.reason },
  };
  const { data: inserted, error: insErr } = await sb.from('network_tasks').insert(taskRow).select('id').single();
  if (insErr) return { ok: false, error: insErr.message };
  const taskId = (inserted as { id: string }).id;
  await sb.from('network_internal_link_opportunities').update({ task_id: taskId, status: 'actioned' }).eq('id', id);
  await sb.rpc('network_log_audit', {
    p_action: 'internal_link_opportunity.converted_to_task',
    p_entity_type: 'network_internal_link_opportunity',
    p_entity_id: id, p_site_id: row.site_id,
    p_old_value: null,
    p_new_value: { task_id: taskId } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'derived',
    p_metadata: { reason: row.reason } as unknown as Record<string, unknown>,
  });
  revalidatePath('/admin/seo/internal-links');
  revalidatePath('/admin/tasks');
  return { ok: true, taskId };
}

export async function dismissInternalLinkOpportunity(id: string): Promise<{ ok: boolean; error?: string }> {
  const { sb } = await requireAdmin('/admin/seo/internal-links');
  const { error } = await sb.from('network_internal_link_opportunities').update({ status: 'dismissed', dismissed_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/seo/internal-links');
  return { ok: true };
}
