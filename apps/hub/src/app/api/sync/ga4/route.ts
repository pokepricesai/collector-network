import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { syncAllGa4, syncAllGa4Country } from '@/server/google/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Daily GA4 sync. Runs the site-daily sync FIRST (that's the one the
// dashboards depend on), then the independent country-dimensioned
// sync which feeds the Singapore-exclusion reporting layer. Both
// write to separate tables and have independent per-site try/catch,
// so a country failure never blocks the main sync. Returning the
// combined result keeps monitoring in one endpoint rather than two
// separate crons.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const today = new Date();
  const site   = await syncAllGa4(sb, today);
  const country = await syncAllGa4Country(sb, today, 3);
  const errors = [...site.errors, ...country.errors];
  const status = errors.length === 0 ? 200 : 207;
  return NextResponse.json({
    ok: errors.length === 0,
    site, country,
    errors,
  }, { status });
}
