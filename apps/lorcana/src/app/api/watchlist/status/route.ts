// Watchlist membership check for a single printing. GET so the
// ISR'd card page can resolve the "Watching ✓" state client-side
// after hydration instead of baking it into cached HTML.
//
// Signed-out callers get `{ watching: false }` (same shape as
// signed-in no-match). No separate 401 — the client just renders a
// "sign in to watch" affordance driven by its own session read.

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const printingId = new URL(req.url).searchParams.get('printingId');
  if (!printingId) {
    return NextResponse.json({ ok: false, error: 'missing_printing_id' }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: true, watching: false, signedIn: false },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
  const { data, error } = await sb
    .from('lorcana_watchlist_items')
    .select('id')
    .eq('user_id', user.id)
    .eq('tcg_printing_id', printingId)
    .maybeSingle();
  if (error) {
    const missingTable =
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      /does not exist/i.test(error.message ?? '') ||
      /Could not find the table/i.test(error.message ?? '');
    if (missingTable) {
      return NextResponse.json({ ok: true, watching: false, signedIn: true });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json(
    { ok: true, watching: !!data, signedIn: true },
    { headers: { 'cache-control': 'no-store' } },
  );
}
