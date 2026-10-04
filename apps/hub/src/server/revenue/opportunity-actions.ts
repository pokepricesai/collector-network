'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { runOpportunityScan } from './opportunities';

export async function scanOpportunitiesAction(): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/opportunities');
  const { inserted, skipped } = await runOpportunityScan(sb);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'opportunities.scan',
    entity_type: 'network_partner_opportunities',
    new_value: { inserted, skipped },
  });
  revalidatePath('/admin/revenue/opportunities');
  revalidatePath('/admin/brief');
}

export async function promoteOpportunityToTaskAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/opportunities');
  const oppId = String(formData.get('id') ?? '').trim();
  if (!oppId) throw new Error('id required');
  const { data: opp, error: oErr } = await sb.from('network_partner_opportunities')
    .select('id, title, rationale, severity, partner_id, site_id, sponsorship_id')
    .eq('id', oppId).maybeSingle();
  if (oErr || !opp) throw new Error(`[opps] promote: not found`);

  const priority = opp.severity === 'critical' ? 'critical' : opp.severity === 'high' ? 'high' : 'normal';
  const { data: task, error: tErr } = await sb.from('network_tasks').insert({
    site_id: opp.site_id,
    title: `[Revenue] ${opp.title}`,
    description: opp.rationale,
    task_type: 'commercial',
    priority,
    status: 'open',
    recommended_action: 'Act on this commercial opportunity. Log outcome in the partner interactions when done.',
    evidence: { opportunity_id: opp.id, partner_id: opp.partner_id, sponsorship_id: opp.sponsorship_id },
    assigned_to: admin.adminRowId,
  }).select('id').single();
  if (tErr) throw new Error(`[opps] task create: ${tErr.message}`);

  await sb.from('network_partner_opportunities').update({ task_id: task.id, status: 'in_progress' }).eq('id', oppId);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'opportunity.promoted', entity_type: 'network_partner_opportunities', entity_id: oppId,
    new_value: { task_id: task.id },
  });
  revalidatePath('/admin/revenue/opportunities');
  revalidatePath('/admin/tasks');
}

export async function dismissOpportunityAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/revenue/opportunities');
  const oppId = String(formData.get('id') ?? '').trim();
  if (!oppId) throw new Error('id required');
  await sb.from('network_partner_opportunities').update({ status: 'dismissed', dismissed_at: new Date().toISOString() }).eq('id', oppId);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'opportunity.dismissed', entity_type: 'network_partner_opportunities', entity_id: oppId,
    new_value: {},
  });
  revalidatePath('/admin/revenue/opportunities');
}
