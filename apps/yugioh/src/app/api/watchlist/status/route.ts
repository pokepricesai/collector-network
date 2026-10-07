// GET /api/watchlist/status?printingId=<tcg_printing_id>
//
// Private, no-store endpoint used by the client WatchButtonMount
// island to resolve the viewer's "is this printing already on my
// watchlist?" state after hydration. Keeping this out of the public
// card page HTML is what allows /card/[slug] and
// /card/[slug]/printing/* to serve from the Full Route Cache without
// baking user-specific state into the ISR snapshot.
//
// Response shape mirrors isWatchingPrinting() so callers can migrate
// trivially. Signed-out callers get { ok: true, watching: false,
// signedIn: false } — no 401, because the WatchButton always needs
// a shape to render against (anonymous visitors see the "sign in to
// watch" CTA, not an error).
//
// Security: this endpoint reads the caller's own watchlist via
// Supabase RLS — never trusts a user_id from input. Mutations live
// in src/app/watchlist/actions.ts.

import { NextResponse, type NextRequest } from 'next/server';
import { isWatchingPrinting } from '../../../../server/watchlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_NO_STORE = 'private, no-store';

export async function GET(req: NextRequest) {
  const printingId = new URL(req.url).searchParams.get('printingId');
  if (!printingId) {
    return NextResponse.json(
      { ok: false, error: 'missing_printing_id' },
      { status: 400, headers: { 'cache-control': PRIVATE_NO_STORE } },
    );
  }
  const r = await isWatchingPrinting(printingId);
  if (!r.ok) {
    // Structural failure — bubble to the client as 5xx so the
    // button degrades to its default (not-watching) rather than
    // asserting a false negative permanently.
    const errorMessage =
      r.reason === 'failed' ? r.error : 'watchlist_table_missing';
    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: 500, headers: { 'cache-control': PRIVATE_NO_STORE } },
    );
  }
  // isWatchingPrinting returns { ok: true, value: false } for both
  // "signed out" and "signed in but not watching this printing".
  // That's exactly the shape the WatchButton needs — the client
  // determines signed-in state from the shared useYgoSession hook,
  // not from this endpoint.
  return NextResponse.json(
    { ok: true, watching: r.value },
    { headers: { 'cache-control': PRIVATE_NO_STORE } },
  );
}
