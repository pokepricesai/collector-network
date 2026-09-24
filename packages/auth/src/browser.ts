'use client';

// Browser Supabase client. One per component tree; @supabase/ssr's
// createBrowserClient internally memoises so calling it repeatedly
// from different components is cheap.

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function createBrowserSupabase(): SupabaseClient {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  if (!url || !key) {
    // Fail hard here rather than half-authenticated; the caller
    // should surface a clear "auth not configured" state.
    throw new Error(
      '[@collector-network/auth] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set for browser auth.',
    );
  }
  return createBrowserClient(url, key);
}
