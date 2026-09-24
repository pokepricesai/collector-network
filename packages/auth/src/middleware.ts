// Middleware helper. Runs on every request that matches the site's
// middleware matcher; refreshes the Supabase session cookie so the
// user's session doesn't silently expire mid-navigation.
//
// The caller (per-site middleware.ts) is responsible for the
// NextResponse and any redirect logic; this helper only touches
// cookies.

import { createServerClient } from '@supabase/ssr';
import type { NextRequest, NextResponse } from 'next/server';

export interface MiddlewareContext {
  request: NextRequest;
  response: NextResponse;
}

// Reads (and refreshes) the current Supabase session for the given
// request/response pair. Returns the user or null. Cookies rotated
// during this call are attached to the response the caller provided.
export async function readMiddlewareSession(
  ctx: MiddlewareContext,
): Promise<{ userId: string | null }> {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
  const key =
    process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] ?? process.env['SUPABASE_ANON_KEY'];
  if (!url || !key) return { userId: null };
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () =>
        ctx.request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          ctx.response.cookies.set(name, value, options);
        }
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { userId: user?.id ?? null };
}
