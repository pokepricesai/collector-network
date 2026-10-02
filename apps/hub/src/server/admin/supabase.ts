import 'server-only';

// Server-side Supabase client for admin surfaces. Uses the shared
// Supabase project's anon key; the actual admin boundary is
// enforced by RLS via public.network_is_admin(), NOT by the key.
// A regular signed-in consumer session therefore gets no admin
// data even though it holds the same anon key.

import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

type CookieStore = Awaited<ReturnType<typeof import('next/headers').cookies>>;

export async function createAdminServerSupabase(): Promise<SupabaseClient> {
  const { cookies } = await import('next/headers');
  const store: CookieStore = await cookies();
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !key) {
    throw new Error(
      '[hub/admin] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }
  type CookieSet = { name: string; value: string; options?: Record<string, unknown> };
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet: CookieSet[]) => {
        try {
          for (const { name, value, options } of toSet) {
            // Supabase's cookie-options object is structurally
            // compatible with Next's CookieOptions; cast to unknown
            // to bridge the two typings.
            store.set(name, value, options as unknown as Parameters<typeof store.set>[2]);
          }
        } catch {
          // RSC render context — cookies() is read-only. Middleware
          // handles the refresh in that case.
        }
      },
    },
  });
}
