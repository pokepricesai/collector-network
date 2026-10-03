import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { buildBrief } from '@/server/brief/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const today = new Date();
  const brief = await buildBrief(sb, today);
  const { error } = await sb
    .from('network_daily_briefs')
    .upsert({ for_date: brief.forDate, payload: brief as unknown as Record<string, unknown> }, { onConflict: 'for_date' });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, forDate: brief.forDate, actions: brief.actions.length, notable: brief.notable.length });
}
