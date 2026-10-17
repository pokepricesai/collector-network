'use server';

// Lightweight stage transition for the Kanban column dropdowns.
// Everything else goes through the full updatePartnerAction form.

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

const VALID_STATUSES = new Set([
  'prospect', 'researching', 'ready_to_contact', 'contacted', 'replied',
  'meeting', 'proposal', 'negotiating', 'won', 'lost', 'nurture', 'archived',
]);

export async function changePartnerStageAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  const toStatus = String(formData.get('status') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim();
  if (!id || !toStatus) throw new Error('id + status required');
  if (!VALID_STATUSES.has(toStatus)) throw new Error('invalid status');

  const before = await sb.from('network_partners').select('status, display_name').eq('id', id).single();
  if (before.error) throw new Error(`[stage] load: ${before.error.message}`);

  const { error } = await sb.from('network_partners').update({ status: toStatus }).eq('id', id);
  if (error) throw new Error(`[stage] update: ${error.message}`);

  // Log a structured interaction so the stage change appears in history.
  await sb.from('network_partner_interactions').insert({
    partner_id: id,
    kind: 'note',
    direction: 'internal',
    summary: `Stage ${before.data.status} → ${toStatus}${notes ? ` · ${notes}` : ''}`,
    detail: notes || null,
    logged_by: admin.adminRowId,
    metadata: { source: 'pipeline_kanban', from: before.data.status, to: toStatus },
  });

  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.stage.changed', entity_type: 'network_partners', entity_id: id,
    new_value: { from: before.data.status, to: toStatus },
  });

  revalidatePath('/admin/partners/pipeline');
  revalidatePath('/admin/partners/morning');
  revalidatePath('/admin/partners');
  revalidatePath(`/admin/partners/${id}`);
  revalidatePath('/admin/partners/first-wave');
}

export async function setFollowUpAction(formData: FormData): Promise<void> {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const id = String(formData.get('id') ?? '').trim();
  const dueRaw = String(formData.get('nextActionDue') ?? '').trim();
  const action = String(formData.get('nextAction') ?? '').trim();
  if (!id) throw new Error('id required');
  const due = dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null;
  const { error } = await sb.from('network_partners').update({ next_action: action || null, next_action_due: due }).eq('id', id);
  if (error) throw new Error(`[follow-up] ${error.message}`);
  await sb.from('network_audit_log').insert({
    actor_type: 'human', actor_user_id: admin.authUserId,
    action: 'partner.followup.set', entity_type: 'network_partners', entity_id: id,
    new_value: { action, due },
  });
  revalidatePath('/admin/partners/pipeline');
  revalidatePath('/admin/partners/morning');
  revalidatePath(`/admin/partners/${id}`);
}
