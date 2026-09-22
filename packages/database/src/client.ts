import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Server-only Supabase client factory. Reads `SUPABASE_URL` and
// `SUPABASE_ANON_KEY` from process.env by default. Never bundle this into
// a client-side chunk with a service-role key.
//
// Anon SELECT is sufficient for the shared read-only tcg_* tables; do not
// introduce service-role usage without an explicit reason.

export interface CreateTcgClientOptions {
  url?: string;
  anonKey?: string;
  fetch?: typeof fetch;
}

export function createTcgClient(
  options: CreateTcgClientOptions = {},
): SupabaseClient {
  const url = options.url ?? process.env['SUPABASE_URL'];
  const anonKey = options.anonKey ?? process.env['SUPABASE_ANON_KEY'];

  if (!url) {
    throw new Error(
      '[@collector-network/database] SUPABASE_URL is required (set env or pass { url })',
    );
  }
  if (!anonKey) {
    throw new Error(
      '[@collector-network/database] SUPABASE_ANON_KEY is required (set env or pass { anonKey })',
    );
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: options.fetch ? { fetch: options.fetch } : undefined,
  });
}

export type { SupabaseClient };
