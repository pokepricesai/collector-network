// Soft geo lookup. Returns the Vercel-provided country ISO code the
// edge saw for this request, so ISR'd pages can resolve regional UX
// (e.g. the eBay marketplace) client-side without baking a country
// into the cached HTML.
//
// Never used for auth, personalisation storage, or affiliate
// attribution integrity. Null is a legitimate answer.

import { NextResponse } from 'next/server';
import { getRequestCountry } from '../../../lib/lorcana/request-country';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const country = await getRequestCountry();
  const res = NextResponse.json({ country });
  // Small browser cache so a page visit doesn't fetch this every
  // navigation; country rarely changes in a session.
  res.headers.set('cache-control', 'private, max-age=300');
  return res;
}
