// Set-completion lookup for the currently signed-in user. GET so
// the ISR'd /set/[slug] page can resolve ownership client-side
// instead of baking user-specific data into the cached HTML.
//
// Signed-out callers get `{ ok: true, signedIn: false, completion: null }`
// so the client can render the sign-in CTA without a 401.
// Set-not-found returns 404. All other errors bubble as 5xx so the
// client can degrade (keeps the panel hidden rather than claiming
// zero ownership).

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';
import { getSetBundleStrict } from '../../../../../server/strict';
import { getSetCompletionForCurrentUser } from '../../../../../server/set-completion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug } = await context.params;
  if (!slug) {
    return NextResponse.json({ ok: false, error: 'missing_slug' }, { status: 400 });
  }

  // Session check first so an anon crawler never pays the set lookup.
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: true, signedIn: false, completion: null },
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  const bundle = await getSetBundleStrict(slug);
  if (!bundle) {
    return NextResponse.json({ ok: false, error: 'set_not_found' }, { status: 404 });
  }

  try {
    const completion = await getSetCompletionForCurrentUser({
      setId: bundle.set.id,
      preloadedCards: bundle.cards,
    });
    return NextResponse.json(
      { ok: true, signedIn: true, completion },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
