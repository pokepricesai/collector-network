import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { runJobBySlug } from '@/server/jobs/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily Impact EPN sync. Scheduled at 06:00 UTC by vercel.json.
//
// Delegates to runJobBySlug('impact.epn.sync_daily') so manual and
// cron runs share one code path and both show up in /admin/jobs.
// The registry wrapper handles network_job_runs lifecycle, stale-run
// recovery, and duplicate-run blocking. An HTTP-level network_alerts
// row is still inserted on fatal failure so pager rules can trigger.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 401 },
    );
  }

  const result = await runJobBySlug('impact.epn.sync_daily');

  if (!result.ok) {
    try {
      const sb = createServiceRoleSupabase();
      await sb.from('network_alerts').insert({
        level: 'critical',
        category: 'impact_epn_sync',
        title: 'Impact EPN daily sync failed',
        description: result.errorSummary ?? 'unknown',
        evidence: { job_run_id: result.jobRunId, summary: result.summary } as unknown as Record<string, unknown>,
      });
    } catch { /* best-effort — do not mask the real error */ }
    return NextResponse.json({ ok: false, result }, { status: 500 });
  }

  return NextResponse.json({ ok: true, result }, { status: 200 });
}
