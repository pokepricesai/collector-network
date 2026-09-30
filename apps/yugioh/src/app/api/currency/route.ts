// Set the site-wide currency preference cookie for YGOPrices.
// POST { currency: 'USD' | 'EUR' } → 200 (cookie set), else 400.
//
// First-party cookie so we don't hit consent-banner territory. Not
// used for auth in any way; the auth session cookie is separate.

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { CURRENCY_COOKIE, isYgoCurrency } from '@/lib/currency';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const raw = body && typeof body === 'object' && 'currency' in body
    ? (body as { currency: unknown }).currency
    : null;
  if (!isYgoCurrency(typeof raw === 'string' ? raw : '')) {
    return NextResponse.json({ ok: false, error: 'currency must be "USD" or "EUR"' }, { status: 400 });
  }
  const c = await cookies();
  c.set(CURRENCY_COOKIE, raw as string, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
    secure: true,
  });
  return NextResponse.json({ ok: true, currency: raw });
}
