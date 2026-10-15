import 'server-only';
import { NextResponse } from 'next/server';
import { createServiceRoleSupabase, assertCronCaller } from '@/server/admin/service-role';
import { driveDraftingFromIdea } from '@/server/content/pipeline';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// CN-04 Slice B · retry drafting for approved ideas held on budget
// or a prior transient failure. Fires on a short cadence (every 30
// minutes per vercel.json) so an idea approved while the rolling
// window was full starts drafting shortly after the window rolls.
//
// Scope: ideas with status='approved' or status='in_brief' that
// carry 'budget_waiting' / 'brief_failed' / 'draft_failed' in
// hold_reasons. Guards against runaway spend: processes at most
// MAX_PER_RUN ideas per invocation and uses the pipeline's own
// budget preflight — if the rolling window is still full the first
// idea will hold and the loop exits early.

const MAX_PER_RUN = 5;
const RETRY_REASONS = ['budget_waiting', 'brief_failed', 'draft_failed'];

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 401 });
  }

  const sb = createServiceRoleSupabase();
  const { data: ideas } = await sb
    .from('network_content_ideas')
    .select('id, hold_reasons, approved_at')
    .in('status', ['approved', 'in_brief'])
    .not('hold_reasons', 'eq', '{}')
    .order('approved_at', { ascending: true, nullsFirst: false })
    .limit(50);

  const retryables = ((ideas ?? []) as Array<{ id: string; hold_reasons: string[]; approved_at: string | null }>)
    .filter((r) => r.hold_reasons.some((h) => RETRY_REASONS.includes(h)))
    .slice(0, MAX_PER_RUN);

  const results: Array<{ id: string; outcome: string; articleId?: string; error?: string }> = [];
  let earlyExit = false;
  for (const r of retryables) {
    const out = await driveDraftingFromIdea(sb, r.id, null);
    results.push({
      id: r.id,
      outcome: out.status,
      ...(out.status === 'drafted' || out.status === 'skipped' ? { articleId: out.articleId } : {}),
      ...(out.status === 'failed' ? { error: out.error } : {}),
    });
    if (out.status === 'budget_waiting') {
      // Rolling window is still full — don't hammer. Next cron tick
      // will retry.
      earlyExit = true;
      break;
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, earlyExit, results });
}
