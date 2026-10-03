'use server';

// Admin server actions for /admin/jobs. Each action:
//   1. Verifies the caller is an active admin via requireAdmin().
//   2. Looks up the job in the server-side allowlist (JOBS registry).
//   3. Invokes the server-side executor directly — no HTTP self-call,
//      no secret shuttling.
//   4. Writes an audit log entry so manual runs are traceable.
//
// CRON_SECRET is NEVER read here. The admin's own session is the
// auth proof; the inner functions use the service-role Supabase
// client server-side only.

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/server/admin/require-admin';
import { JOBS, runJobBySlug, type JobRunResult } from '@/server/jobs/registry';

export async function runAdminJob(slug: string, confirmed: boolean): Promise<{
  ok: boolean;
  slug: string;
  result?: JobRunResult;
  error?: string;
}> {
  const { admin, sb } = await requireAdmin('/admin/jobs');
  const def = JOBS[slug];
  if (!def) return { ok: false, slug, error: `unknown job slug: ${slug}` };
  if (def.requiresConfirmation && !confirmed) {
    return { ok: false, slug, error: 'confirmation required' };
  }

  // Audit the manual trigger BEFORE running — regardless of outcome
  // we want evidence an admin kicked this off.
  await sb.rpc('network_log_audit', {
    p_action: 'job.manual_trigger',
    p_entity_type: 'network_job_runs',
    p_entity_id: null,
    p_site_id: null,
    p_old_value: null,
    p_new_value: { slug, job_name: def.jobName, label: def.label } as unknown as Record<string, unknown>,
    p_actor_type: 'human',
    p_source: 'manual',
    p_metadata: { actor_email: admin.email } as unknown as Record<string, unknown>,
  });

  const result = await runJobBySlug(slug);

  revalidatePath('/admin/jobs');
  revalidatePath('/admin/health');
  revalidatePath('/admin');

  return { ok: result.ok, slug, result, error: result.ok ? undefined : (result.errorSummary ?? 'unknown error') };
}
