// Watchlist toggle API. POST to add, DELETE to remove.
// Body: { tcg_card_id, tcg_printing_id }. RLS enforces owner
// isolation through createServerSupabase().

import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@collector-network/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  tcg_card_id?: string;
  tcg_printing_id?: string;
}

async function readBody(req: NextRequest): Promise<Body | null> {
  try {
    return (await req.json()) as Body;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  if (!body?.tcg_card_id || !body?.tcg_printing_id) {
    return NextResponse.json({ ok: false, error: 'missing_ids' }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const { error } = await sb.from('lorcana_watchlist_items').upsert(
    {
      user_id: user.id,
      tcg_card_id: body.tcg_card_id,
      tcg_printing_id: body.tcg_printing_id,
    },
    { onConflict: 'user_id,tcg_printing_id' },
  );
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, watching: true });
}

export async function DELETE(req: NextRequest) {
  const body = await readBody(req);
  if (!body?.tcg_printing_id) {
    return NextResponse.json({ ok: false, error: 'missing_printing_id' }, { status: 400 });
  }
  const sb = await createServerSupabase();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 });
  const { error } = await sb.from('lorcana_watchlist_items')
    .delete()
    .eq('user_id', user.id)
    .eq('tcg_printing_id', body.tcg_printing_id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, watching: false });
}
