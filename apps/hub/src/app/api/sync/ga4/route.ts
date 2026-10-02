import { NextResponse } from 'next/server';
import { assertCronCaller, createServiceRoleSupabase } from '@/server/admin/service-role';
import { syncAllGa4 } from '@/server/google/sync';

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
  const result = await syncAllGa4(sb, new Date());
  const status = result.errors.length === 0 ? 200 : 207;
  return NextResponse.json({ ok: result.errors.length === 0, ...result }, { status });
}
