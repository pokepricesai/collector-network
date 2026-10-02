'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';

// Converts an opportunity into a task. Writes:
//   • network_tasks (new row, source_code='derived')
//   • network_opportunities.task_id + status='actioned'
//   • network_audit_log (via network_log_audit RPC)
//
// All writes happen under the admin's own session — RLS still
// enforces that only admins can modify these tables. Service-role
// key is not used here.

interface OpportunityRow {
  id: string;
  site_id: string;
  kind: string;
  page: string;
  query: string;
  title: string;
  description: string | null;
  severity: 'critical' | 'high' | 'normal' | 'low';
  evidence: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export async function createTaskFromOpportunity(opportunityId: string): Promise<{
  ok: boolean;
  taskId?: string;
  error?: string;
}> {
  const { admin, sb } = await requireAdmin('/admin/seo/opportunities');

  const { data: oppRaw, error: fetchErr } = await sb
    .from('network_opportunities')
    .select('id, site_id, kind, page, query, title, description, severity, evidence, metrics, task_id, status')
    .eq('id', opportunityId)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!oppRaw) return { ok: false, error: 'opportunity not found' };
  const opp = oppRaw as OpportunityRow & { task_id: string | null; status: string };

  if (opp.task_id) {
    return { ok: true, taskId: opp.task_id };
  }

  const recommended = recommendation(opp);

  const taskInsert = {
    site_id: opp.site_id,
    title: opp.title,
    description: opp.description,
    task_type: 'seo_opportunity',
    source_code: 'derived',
    priority: opp.severity,
    status: 'open' as const,
    evidence: {
      opportunity_id: opp.id,
      opportunity_kind: opp.kind,
      page: opp.page || null,
      query: opp.query || null,
      metrics: opp.metrics,
      evidence: opp.evidence,
    },
    recommended_action: recommended,
    assigned_to: admin.adminRowId,
    metadata: { opportunity_kind: opp.kind },
  };

  const { data: insertedRow, error: insertErr } = await sb
    .from('network_tasks')
    .insert(taskInsert)
    .select('id')
    .single();
  if (insertErr) return { ok: false, error: insertErr.message };
  const taskId = (insertedRow as { id: string }).id;

  const { error: linkErr } = await sb
    .from('network_opportunities')
    .update({ task_id: taskId, status: 'actioned' })
    .eq('id', opp.id);
  if (linkErr) return { ok: false, error: linkErr.message };

  await sb.rpc('network_log_audit', {
    p_action: 'opportunity.converted_to_task',
    p_entity_type: 'network_opportunity',
    p_entity_id: opp.id,
    p_site_id: opp.site_id,
    p_old_value: { status: 'open' } as unknown as Record<string, unknown>,
    p_new_value: { status: 'actioned', task_id: taskId } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'derived',
    p_metadata: { kind: opp.kind, page: opp.page, query: opp.query } as unknown as Record<string, unknown>,
  });

  revalidatePath('/admin/seo/opportunities');
  revalidatePath('/admin/tasks');
  return { ok: true, taskId };
}

export async function dismissOpportunity(
  opportunityId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const { admin, sb } = await requireAdmin('/admin/seo/opportunities');
  const { error } = await sb
    .from('network_opportunities')
    .update({
      status: 'dismissed',
      dismissed_at: new Date().toISOString(),
      dismissed_by: admin.adminRowId,
      dismiss_reason: reason.slice(0, 400),
    })
    .eq('id', opportunityId);
  if (error) return { ok: false, error: error.message };
  await sb.rpc('network_log_audit', {
    p_action: 'opportunity.dismissed',
    p_entity_type: 'network_opportunity',
    p_entity_id: opportunityId,
    p_site_id: null,
    p_old_value: null,
    p_new_value: { reason } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'derived',
    p_metadata: {} as unknown as Record<string, unknown>,
  });
  revalidatePath('/admin/seo/opportunities');
  return { ok: true };
}

function recommendation(opp: OpportunityRow): string {
  switch (opp.kind) {
    case 'low_ctr':
      return 'Rewrite the page title and meta description to match the query intent. Lead with the exact phrase; include a differentiator (price, condition, year, set).';
    case 'striking_distance':
      return 'Add internal links from authority pages (sitemap root, high-click siblings). Review the primary content for topical depth. Consider a focused rewrite including the exact query in H1 / first paragraph.';
    case 'zero_click':
      return 'The page is being shown but attracting zero clicks. Rewrite title/meta to be clearly relevant to the query — current wording is likely mismatched.';
    case 'declining':
      return 'Investigate the ranking drop: check for duplicate content, cannibalisation, slow page speed, or recent GSC Core Update dates. Refresh content if stale.';
    case 'gaining':
      return 'This page is winning — reinforce it. Add related internal pages, link from the home/hub pages, and ensure structured data is still correct.';
    case 'new_query':
      return 'A new user intent is forming. Decide whether to lean into it: either optimise this page further for the query, or spawn a dedicated page targeting the phrase.';
    default:
      return 'Review the evidence and determine the appropriate action.';
  }
}
