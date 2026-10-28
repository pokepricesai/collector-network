import { NextResponse } from 'next/server';
import { assertCronCaller } from '@/server/admin/service-role';
import { runJobBySlug } from '@/server/jobs/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Jobs page tracking fix — this route previously called
// generateOpportunities(sb, new Date()) directly, which meant no
// network_job_runs row was ever written. The engine ran successfully
// every day (data existed in network_opportunities) but the Jobs
// page displayed "Never run" for opportunities.generate because the
// audit record was missing.
//
// Routing through runJobBySlug('opportunities.generate') uses the
// existing registry definition, writes the outer network_job_runs
// row (wrapsOuter=true in the registry), and reports success/failure
// consistently with every other cron.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const result = await runJobBySlug('opportunities.generate');
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
