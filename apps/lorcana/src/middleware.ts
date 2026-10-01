import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// Canonical origin for LorcanaPrices. Vercel's project-domain config
// forces apex → www (308), so our middleware does not need to canonical
// anything by itself. The Vercel deployment host
// (lorcana-web.vercel.app) is left alone so preview/CI still work.
const CANONICAL_HOST = 'www.lorcanaprices.io';

// Session-refresh middleware. Runs on every routable path so the
// Supabase auth cookie stays fresh across navigation. Per-route
// protection lives inside route handlers via requireUser().
export async function middleware(request: NextRequest) {
  // Keep the middleware passive — just a touch for the session cookie
  // refresh. All host canonicalisation is handled by Vercel's own
  // apex→www domain redirect.
  void CANONICAL_HOST;
  const response = NextResponse.next();
  await readMiddlewareSession({ request, response });
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|sitemap.xml|sitemap-.*\\.xml|robots.txt|opengraph-image).*)',
  ],
};
