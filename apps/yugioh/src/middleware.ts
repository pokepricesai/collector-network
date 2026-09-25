import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// The canonical apex host. www.<canonical> gets a 308 permanent
// redirect so search engines and users converge on one origin. The
// Vercel deployment hostname (yugioh-web.vercel.app) is left alone
// deliberately: it is used by preview/CI tooling and rewriting it
// would break those flows.
const CANONICAL_HOST = 'ygoprices.io';

// Slice C: session-refresh middleware. Runs on every routable path
// (excluding the assets matcher below) so the Supabase auth cookie
// stays fresh across navigation. Per-route protection lives inside
// the route handlers via requireUser().
export async function middleware(request: NextRequest) {
  // www -> apex redirect (308 so browsers + crawlers cache it).
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
  // Skip static assets and the icon/OG endpoints so we don't waste
  // Lambda time on them. Next's built-in matcher syntax.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|ygoprices-logo.png|sitemap.xml|sitemap|robots.txt|api/prewarm).*)',
  ],
};
