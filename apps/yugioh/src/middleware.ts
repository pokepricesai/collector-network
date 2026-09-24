import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// Slice C: session-refresh middleware. Runs on every routable path
// (excluding the assets matcher below) so the Supabase auth cookie
// stays fresh across navigation. Never redirects; per-route protection
// lives inside the route handlers via `requireUser()`.
export async function middleware(request: NextRequest) {
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
