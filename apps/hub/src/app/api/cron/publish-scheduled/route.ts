import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { runScheduledPublishBatch } from '@/server/content/publish';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// CN-04 Slice C · publish articles whose scheduled_for has come due.
// Runs every 5 minutes. Each due article is atomically claimed via
// network_claim_scheduled_article (advisory lock + CAS) so two
// overlapping cron fires can't double-publish.

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const results = await runScheduledPublishBatch(sb, { max: 10 });
  return NextResponse.json({ ok: true, processed: results.length, results });
}
