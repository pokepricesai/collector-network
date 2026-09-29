// Set the site-wide currency preference cookie.
// POST { currency: 'EUR' | 'USD' } → 200 (cookie set), else 400.

import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { CURRENCY_COOKIE, isOpCurrency } from '@/lib/onepiece/currency';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: unknown;
  try { body = await req.json(); } catch { body = null; }
  const raw = (body && typeof body === 'object' && 'currency' in body ? (body as { currency: unknown }).currency : null);
  if (!isOpCurrency(typeof raw === 'string' ? raw : '')) {
    return NextResponse.json({ ok: false, error: 'currency must be "EUR" or "USD"' }, { status: 400 });
  }
  const c = await cookies();
  c.set(CURRENCY_COOKIE, raw as string, {
    // 1 year. First-party, top-level path. Safe SameSite for a global
    // preference, not authoritative for any auth flow.
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: false,
    secure: true,
  });
  return NextResponse.json({ ok: true, currency: raw });
}
