import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// Canonical origin for OnePiecePrices. www gets a 308 to apex so
// browsers and crawlers converge. Vercel deployment hosts
// (onepiece-web.vercel.app) are left alone so preview/CI still work.
const CANONICAL_HOST = 'onepieceprices.io';

// Session-refresh middleware. Runs on every routable path so the
// Supabase auth cookie stays fresh across navigation. Per-route
// protection lives inside route handlers via requireUser().
export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') ?? '';
  if (host === `www.${CANONICAL_HOST}`) {
    const url = request.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }
  const response = NextResponse.next();
  await readMiddlewareSession({ request, response });
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|logo.png|sitemap.xml|sitemap-.*\\.xml|robots.txt|opengraph-image).*)',
  ],
};
