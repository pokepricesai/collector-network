import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { ingestImpactEpn } from '@/server/impact/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily Impact EPN sync. Scheduled at 06:00 UTC by vercel.json.
//
// Window: 7-day overlap. Any Action whose state has changed in the
// last week is re-upserted (idempotent via impact:epn:<Id>), and any
// status change is appended to network_affiliate_status_history by
// the ingest module.
//
// Returns:
//   200 — ok, no errors
//   207 — ok but some per-chunk warnings/errors (partial success)
//   401 — bad cron secret
//   500 — fatal (job marked failed, alert inserted)

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const sb = createServiceRoleSupabase();

  // Start job run.
  let jobId: string | null = null;
  try {
    const { data, error } = await sb.rpc('network_start_job_run', {
      p_job_name: 'impact_epn_sync',
      p_job_type: 'sync',
      p_site_id: null,
      p_metadata: { source: 'cron', endpoint: '/api/sync/impact-epn' } as unknown as Record<string, unknown>,
    });
    if (error) throw new Error(error.message);
    jobId = (data as string) ?? null;
  } catch (err) {
    // If we can't even start a job run, log an alert and bail.
    await insertAlert(sb, 'critical', 'impact_epn_sync', 'Impact EPN sync failed to start job', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'start_job_run failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  try {
    const result = await ingestImpactEpn(sb, { totalDays: 7, windowDays: 7 });

    const hasFatal = result.skipped_reason != null || result.errors.length > 0;
    const status: 'success' | 'partial' | 'failed' = hasFatal
      ? 'failed'
      : result.warnings.length > 0 ? 'partial' : 'success';

    if (jobId) {
      if (status === 'failed') {
        await sb.rpc('network_fail_job_run', {
          p_id: jobId,
          p_error_summary: (result.errors[0] ?? result.skipped_reason ?? 'unknown').slice(0, 500),
          p_metadata: { summary: resultSummary(result) } as unknown as Record<string, unknown>,
        });
      } else {
        await sb.rpc('network_complete_job_run', {
          p_id: jobId,
          p_status: status === 'partial' ? 'partial' : 'success',
          p_rows_examined: result.actions_seen,
          p_rows_inserted: result.actions_inserted,
          p_rows_updated: result.actions_updated,
          p_rows_rejected: result.actions_rejected_unknown_shared_id + result.actions_rejected_missing_critical_fields,
          p_error_summary: result.warnings[0] ?? null,
          p_metadata: { summary: resultSummary(result) } as unknown as Record<string, unknown>,
        });
      }
    }

    if (status === 'failed') {
      await insertAlert(sb, 'critical', 'impact_epn_sync', 'Impact EPN sync failed', result.errors[0] ?? result.skipped_reason ?? 'unknown');
      return NextResponse.json({ ok: false, status, result }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status, result }, { status: status === 'partial' ? 207 : 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (jobId) {
      try {
        await sb.rpc('network_fail_job_run', { p_id: jobId, p_error_summary: msg.slice(0, 500), p_metadata: null as unknown as Record<string, unknown> });
      } catch { /* best-effort */ }
    }
    await insertAlert(sb, 'critical', 'impact_epn_sync', 'Impact EPN sync threw', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function resultSummary(result: Awaited<ReturnType<typeof ingestImpactEpn>>) {
  return {
    actions_seen: result.actions_seen,
    actions_upserted: result.actions_upserted,
    actions_inserted: result.actions_inserted,
    actions_updated: result.actions_updated,
    status_history_rows_inserted: result.status_history_rows_inserted,
    rejected_unknown_shared_id: result.actions_rejected_unknown_shared_id,
    rejected_missing_fields: result.actions_rejected_missing_critical_fields,
    by_slug: result.by_slug,
    windows_failed: result.windows.filter((w) => w.status === 'failed').length,
    windows_partial: result.windows.filter((w) => w.status === 'partial').length,
  };
}

async function insertAlert(
  sb: ReturnType<typeof createServiceRoleSupabase>,
  level: 'critical' | 'warning' | 'opportunity' | 'info',
  category: string,
  title: string,
  description: string,
): Promise<void> {
  try {
    await sb.from('network_alerts').insert({
      level,
      category,
      title,
      description,
      evidence: {} as Record<string, unknown>,
    });
  } catch { /* best-effort — don't let alerting failures mask the real error */ }
}
