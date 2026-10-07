import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// Session-refresh middleware. Runs ONLY on routes whose server tree
// reads the Supabase session cookie (requireUser-protected pages,
// auth callbacks that write session cookies, and the private
// watchlist status API). Public catalogue + SEO routes are
// deliberately NOT matched so a Full Route Cache HIT serves without
// paying Vercel middleware cost or a Supabase /auth/v1/user call.
//
// www -> apex canonicalisation lives at the Vercel routing layer
// in apps/yugioh/vercel.json (shipped in YGO P0-7 Stage 1) so this
// middleware no longer needs to see public requests merely to
// rewrite the host.
//
// Per-route protection continues to live inside the route handlers
// via requireUser(). Mutation server actions and authenticated API
// routes remain Supabase-RLS-scoped; the middleware refresh is a
// convenience, not a security boundary.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  await readMiddlewareSession({ request, response });
  return response;
}

export const config = {
  // Narrow positive allowlist. Each entry is a route whose server
  // tree reads the Supabase session cookie:
  //
  //   /account/:path*     — requireUser() on /account +
  //                         /account/reset-password
  //   /collection         — requireUser()
  //   /watchlist          — requireUser()
  //   /decks/:path*       — requireUser() on /decks, /decks/new,
  //                         /decks/[id]
  //   /dashboard          — requireUser()
  //   /settings           — requireUser()
  //   /email-preferences  — requireUser()
  //   /auth/:path*        — callback (writes session), confirm
  //                         (writes session), sign-out (clears
  //                         session)
  //   /api/watchlist/:path* — RLS-scoped read in
  //                           /api/watchlist/status
  //
  // Public catalogue + SEO routes (/, /card/*, /set/*, /rarity/*,
  // /archetype/*, /market*, /sets, /rarities, /archetypes,
  // /insights*, /forbidden-limited, /card-finder, /search, /contact,
  // /privacy, /terms, /sign-in, /sign-up) bypass middleware
  // entirely. The P0-6 API carve-outs (/api/search, /api/currency,
  // /api/affiliate, /api/ai/ask, /api/revalidate, /api/prewarm) are
  // naturally excluded by the positive allowlist. Static assets
  // (_next, favicon, logos, sitemap, robots) also naturally
  // excluded.
  matcher: [
    '/account/:path*',
    '/collection',
    '/watchlist',
    '/decks/:path*',
    '/dashboard',
    '/settings',
    '/email-preferences',
    '/auth/:path*',
    '/api/watchlist/:path*',
  ],
};
