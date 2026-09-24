// Server-side Supabase client with Next.js 15 cookie handling.
// Every request in an RSC / route handler / server action gets its
// own client that reads and writes the sb-* auth cookies. The
// cookies() helper from next/headers is dynamically imported so this
// module can be safely referenced from middleware (which does not
// have access to next/headers).

import { createServerClient } from '@supabase/ssr';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';

// Cookies helper is loaded lazily via dynamic import; the return type
// is intentionally loose because Next.js does not re-export it.
type CookieStore = Awaited<ReturnType<typeof import('next/headers').cookies>>;

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[@collector-network/auth] ${name} must be set for server-side auth.`,
    );
  }
  return v;
}

export async function createServerSupabase(): Promise<SupabaseClient> {
  // We import next/headers lazily so this file loads cleanly inside
  // middleware.ts (which uses NextRequest cookies instead).
  const { cookies } = await import('next/headers');
  const store: CookieStore = await cookies();
  const url =
    process.env['NEXT_PUBLIC_SUPABASE_URL'] ??
    envOrThrow('SUPABASE_URL');
  const key =
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ??
    envOrThrow('SUPABASE_ANON_KEY');
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (cookiesToSet) => {
        // In an RSC render context Next 15 throws on cookie writes;
        // swallow — the middleware refresh handles cookie rotation.
        try {
          for (const { name, value, options } of cookiesToSet) {
            store.set(name, value, options);
          }
        } catch {
          /* RSC render — cookies() is read-only here */
        }
      },
    },
  });
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

// Protected-route helper. If no session, redirects the caller to
// `signInPath` with `?returnTo=<current-path>` so post-signin
// navigation lands the user back where they started.
export async function requireUser(
  currentPath: string,
  options: { signInPath?: string } = {},
): Promise<User> {
  const user = await getCurrentUser();
  if (user) return user;
  const dest = options.signInPath ?? '/sign-in';
  const returnTo = encodeURIComponent(currentPath);
  // `redirect` throws NEXT_REDIRECT, so control never reaches the
  // return below; TypeScript needs the explicit throw for narrowing.
  redirect(`${dest}?returnTo=${returnTo}`);
  throw new Error('unreachable');
}
