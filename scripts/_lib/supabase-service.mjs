// Shared service-role Supabase client for investigation scripts.
//
// PP-TCG-500-PREP-1 — security remediation. Previously every
// scripts/*.mjs inlined a hardcoded JWT. This helper loads the
// credential from the local environment at runtime so no secret
// is ever committed to source.
//
// Usage:
//   import { getSupabaseServiceClient } from './_lib/supabase-service.mjs'
//   const sb = await getSupabaseServiceClient()
//
// Resolution order for the credential:
//   1. process.env.SUPABASE_SERVICE_ROLE_KEY (CI/explicit export)
//   2. apps/hub/.env.local (local dev; the hub owns this project)
//
// Fails fast with a clear error if neither source supplies the key.
// Never prints the key value, even in error messages.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const SUPABASE_URL = 'https://egidpsrkqvymvioidatc.supabase.co'

function parseEnvLocal(path) {
  try {
    const txt = readFileSync(path, 'utf-8')
    const out = {}
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[m[1]] = v
    }
    return out
  } catch {
    return {}
  }
}

function resolveServiceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  const envLocal = parseEnvLocal(resolve(process.cwd(), 'apps/hub/.env.local'))
  if (envLocal.SUPABASE_SERVICE_ROLE_KEY) return envLocal.SUPABASE_SERVICE_ROLE_KEY
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY not available. Set it in the environment or ensure apps/hub/.env.local contains it. ' +
    'This script refuses to run without it rather than falling back to a committed credential.'
  )
}

export async function getSupabaseServiceClient() {
  const key = resolveServiceKey()
  const req = createRequire(resolve(process.cwd(), 'apps/hub/package.json'))
  const { createClient } = req('@supabase/supabase-js')
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export const SUPABASE_PROJECT_URL = SUPABASE_URL
