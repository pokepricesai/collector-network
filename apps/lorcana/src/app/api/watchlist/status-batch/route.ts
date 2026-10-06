// Batch watchlist membership check. POST { printingIds: string[] }
// returns { watching: Record<printingId, boolean>, signedIn: boolean }.
//
// Used by the ISR'd /card/[slug] page's LogicalWatch picker, where
// a single logical card can have 10+ printings and firing one GET
// /api/watchlist/status per printing on mount would be wasteful.
//
// Signed-out callers get all-false — same shape as signed-in no-match
// — so the client can render a single response without a 401 branch.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const printingIds = Array.isArray((body as { printingIds?: unknown })?.printingIds)
    ? ((body as { printingIds: unknown[] }).printingIds.filter(
        (v): v is string => typeof v === 'string' && v.length > 0,
      ) as string[])
    : null;
  if (!printingIds) {
    return NextResponse.json({ ok: false, error: 'missing_printing_ids' }, { status: 400 });
  }
  if (printingIds.length === 0) {
    return NextResponse.json({ ok: true, signedIn: false, watching: {} });
  }
  // Defence-in-depth cap. A logical card never has thousands of
  // printings; limit the request to a sensible page-level ceiling.
  if (printingIds.length > 200) {
    return NextResponse.json({ ok: false, error: 'too_many_ids' }, { status: 400 });
  }

  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  const empty: Record<string, boolean> = {};
  for (const id of printingIds) empty[id] = false;
  if (!user) {
    return NextResponse.json(
      { ok: true, signedIn: false, watching: empty },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const { data, error } = await sb
    .from('lorcana_watchlist_items')
    .select('tcg_printing_id')
    .eq('user_id', user.id)
    .in('tcg_printing_id', printingIds);
  if (error) {
    const missingTable =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      /does not exist/i.test(error.message ?? '') ||
      /Could not find the table/i.test(error.message ?? '');
    if (missingTable) {
      return NextResponse.json({ ok: true, signedIn: true, watching: empty });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const watching: Record<string, boolean> = { ...empty };
  for (const row of (data as { tcg_printing_id: string }[] | null) ?? []) {
    watching[row.tcg_printing_id] = true;
  }

  return NextResponse.json(
    { ok: true, signedIn: true, watching },
    { headers: { 'cache-control': 'no-store' } },
  );
}
