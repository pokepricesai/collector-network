import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { generateOpportunities } from '@/server/opportunities/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  try {
    assertCronCaller(req);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 401 });
  }
  const sb = createServiceRoleSupabase();
  const result = await generateOpportunities(sb, new Date());
  return NextResponse.json({ ok: true, ...result });
}
