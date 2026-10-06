import { NextResponse, type NextRequest } from 'next/server';
import { readMiddlewareSession } from '@collector-network/auth';

// Session-refresh middleware. Runs only on the explicit allowlist of
// routes whose server tree reads or writes the Supabase session
// cookie. Server Components can only READ cookies (Next.js constraint
// on RSC render), so middleware is the only pre-render place that can
// both read the request cookie and write the refreshed response cookie.
//
// Scope note (P0b): the matcher was previously a wide negative pattern
// that ran on every public catalogue + static page. The audit in
// commits around 2026-10-06 (and the MTG precedent, see
// mtgprices-web/src/middleware.ts) confirmed:
//   - public catalogue pages that call getCurrentUser do so for
//     conditional UX only; a stale cookie just renders the anon
//     variant, no security impact — the client AccountChip
//     subscription keeps the navbar correct
//   - /sign-in and /sign-up do not read the session server-side;
//     they only mount a client AuthForm
//   - /api/watchlist self-manages its cookies via createServerSupabase
//     in a Route Handler (cookies().set() works there, unlike RSC)
//   - /api/ai/ask is intentionally public (feature-flagged + 503
//     fallback); /api/currency never touches the session
//   - /ai is a pure static discovery shell; the AI itself lives on
//     card pages via /api/ai/ask
//
// If a new Server Component page starts reading the Supabase session
// (via getCurrentUser / requireUser / createServerSupabase) or writes
// an auth cookie, add its path pattern to the matcher below. Grep for
// `getCurrentUser|requireUser|createServerSupabase` across src/app
// finds every current session-reader.
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  await readMiddlewareSession({ request, response });
  return response;
}

export const config = {
  // Explicit auth-sensitive allowlist. Only routes whose server tree
  // reads the Supabase session cookie — or writes it — need the
  // middleware refresh:
  //
  //   /auth/callback         exchangeCodeForSession writes session cookie
  //   /auth/sign-out         supabase.auth.signOut writes cleared cookie
  //   /account/*             getCurrentUser → redirect anon to /sign-in
  //                          (includes /account/reset-password which
  //                          reads getCurrentUser to show signed-in state)
  //   /dashboard             getCurrentUser → redirect anon to /sign-in
  //   /settings/*            getCurrentUser → redirect anon to /sign-in
  //   /collection            requireUser → redirect anon to /sign-in
  //   /watchlist             getCurrentUser → redirect anon to /sign-in
  //
  // Everything else is deliberately NOT matched — see the comment at
  // the top of this file for the per-route rationale.
  matcher: [
    '/auth/:path*',
    '/account/:path*',
    '/dashboard',
    '/settings/:path*',
    '/collection',
    '/watchlist',
  ],
};
