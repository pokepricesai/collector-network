// PP-TCG-500-PREP-1 — side-effect import that loads apps/hub/.env.local
// into process.env so investigation scripts can read
// SUPABASE_SERVICE_ROLE_KEY without hardcoding it.
//
// Usage:  import './_lib/load-env.mjs'   (as the first script import)
//
// Resolution:
//   1. Pre-set process.env values are left untouched (CI wins).
//   2. apps/hub/.env.local parsed line-by-line into process.env.
//   3. If SUPABASE_SERVICE_ROLE_KEY is still unset after both, throw.
// Never prints the key value.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

try {
  const txt = readFileSync(resolve(process.cwd(), 'apps/hub/.env.local'), 'utf-8')
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[m[1]]) process.env[m[1]] = v
  }
} catch {
  // File may be absent in CI — that's fine as long as env is pre-set.
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY not available. Set it in the environment or ensure apps/hub/.env.local contains it. ' +
    'Investigation scripts no longer accept a hardcoded fallback.'
  )
}
