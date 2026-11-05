import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG, runOnce, selectBatch } from '../refresh'

// Load the migration file once — several contract tests assert the
// RPC SQL honours the deterministic-identity policy.
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261105100000_cn0605_psa_refresh.sql'),
  'utf8',
)

// This suite stubs @supabase/supabase-js by providing a hand-rolled client
// that records all table + rpc calls. It focuses on the scheduler's
// invariants without a live DB.

type FakeCall =
  | { kind: 'rpc'; name: string; args: Record<string, unknown> }
  | { kind: 'from'; table: string }
  | { kind: 'update'; table: string; patch: Record<string, unknown>; where: string[] }
  | { kind: 'upsert'; table: string; row: Record<string, unknown>; onConflict: string }

type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: unknown }
type SelectHandler = (where: Record<string, unknown>) => { data: unknown[]; error: unknown }

function makeStub(opts: {
  rpcs?: Record<string, RpcHandler>
  selects?: Record<string, SelectHandler>
} = {}) {
  const calls: FakeCall[] = []
  const rpcs = opts.rpcs ?? {}
  const selects = opts.selects ?? {}

  const client: any = {
    _calls: calls,
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ kind: 'rpc', name, args })
      const handler = rpcs[name]
      if (handler) return Promise.resolve(handler(args))
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      calls.push({ kind: 'from', table })
      const where: Record<string, unknown> = {}
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { where[col] = val; return chain },
        is: (col: string, val: unknown) => { where[col] = val; return chain },
        not: () => chain,
        gt: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => {
          const handler = selects[table]
          if (handler) return Promise.resolve(handler(where))
          return Promise.resolve({ data: [], error: null })
        },
        upsert: (row: any, opts: any) => {
          calls.push({ kind: 'upsert', table, row, onConflict: opts?.onConflict ?? '' })
          return Promise.resolve({ data: null, error: null })
        },
        update: (patch: Record<string, unknown>) => ({
          eq: (col: string, val: unknown) => {
            calls.push({ kind: 'update', table, patch, where: [`${col}=${val}`] })
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
      return chain
    },
  }
  return { client, calls }
}

// ──────────────────────────────────────────────────────────────────────
// Flag + token gates
// ──────────────────────────────────────────────────────────────────────

describe('runOnce — feature flag and token gates', () => {
  const ORIG_FLAG = process.env['CN_PSA_REFRESH_ENABLED']
  const ORIG_TOKEN = process.env['PSA_PUBLIC_API_TOKEN']
  afterEach(() => {
    if (ORIG_FLAG === undefined) delete process.env['CN_PSA_REFRESH_ENABLED']
    else process.env['CN_PSA_REFRESH_ENABLED'] = ORIG_FLAG
    if (ORIG_TOKEN === undefined) delete process.env['PSA_PUBLIC_API_TOKEN']
    else process.env['PSA_PUBLIC_API_TOKEN'] = ORIG_TOKEN
  })

  it('returns disabled + no RPC calls when flag not set', async () => {
    delete process.env['CN_PSA_REFRESH_ENABLED']
    process.env['PSA_PUBLIC_API_TOKEN'] = 'tok'
    const { client, calls } = makeStub()
    const r = await runOnce(client)
    expect(r.status).toBe('disabled')
    expect(r.reason).toMatch(/CN_PSA_REFRESH_ENABLED/)
    expect(calls.length).toBe(0)
  })

  it('returns disabled + no RPC calls when token missing even if flag on', async () => {
    process.env['CN_PSA_REFRESH_ENABLED'] = '1'
    delete process.env['PSA_PUBLIC_API_TOKEN']
    const { client, calls } = makeStub()
    const r = await runOnce(client)
    expect(r.status).toBe('disabled')
    expect(r.reason).toMatch(/PSA_PUBLIC_API_TOKEN/)
    expect(calls.length).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Lock contention
// ──────────────────────────────────────────────────────────────────────

describe('runOnce — concurrent invocation safety via lock', () => {
  beforeEach(() => {
    process.env['CN_PSA_REFRESH_ENABLED'] = '1'
    process.env['PSA_PUBLIC_API_TOKEN'] = 'tok'
  })

  it('exits with no_lock status when cn_psa_acquire_lock returns false', async () => {
    const { client, calls } = makeStub({
      rpcs: { cn_psa_acquire_lock: () => ({ data: false, error: null }) },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('no_lock')
    // Only the lock RPC was called; no reservation, no selection, no fetch.
    const rpcNames = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcNames).toEqual(['cn_psa_acquire_lock'])
  })

  it('releases lock even when batch finishes empty', async () => {
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:        () => ({ data: true,  error: null }),
        cn_psa_reserve_slots:       () => ({ data: 10,    error: null }),
        cn_psa_recompute_priority:  () => ({ data: 0,     error: null }),
        cn_psa_release_lock:        () => ({ data: true,  error: null }),
      },
      selects: {
        cn_psa_candidates: () => ({ data: [], error: null }),
      },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('no_candidates')
    const rpcNames = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcNames).toContain('cn_psa_release_lock')
  })
})

// ──────────────────────────────────────────────────────────────────────
// Reservation cap — every attempt counts against the daily budget
// ──────────────────────────────────────────────────────────────────────

describe('runOnce — budget reservation is the single arbiter', () => {
  beforeEach(() => {
    process.env['CN_PSA_REFRESH_ENABLED'] = '1'
    process.env['PSA_PUBLIC_API_TOKEN'] = 'tok'
  })

  it('exits as budget_exhausted when reserve returns 0', async () => {
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:        () => ({ data: true,  error: null }),
        cn_psa_reserve_slots:       () => ({ data: 0,     error: null }),
        cn_psa_release_lock:        () => ({ data: true,  error: null }),
      },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('budget_exhausted')
    // No selectBatch hits + no fetches + release called.
    const rpcNames = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcNames).toContain('cn_psa_reserve_slots')
    expect(rpcNames).toContain('cn_psa_release_lock')
    expect(rpcNames).not.toContain('cn_psa_recompute_priority')
  })

  it('reserves budget exactly once per fire (not per candidate)', async () => {
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:        () => ({ data: true,  error: null }),
        cn_psa_reserve_slots:       () => ({ data: 3,     error: null }),
        cn_psa_recompute_priority:  () => ({ data: 0,     error: null }),
        cn_psa_release_lock:        () => ({ data: true,  error: null }),
      },
      selects: {
        cn_psa_candidates: () => ({ data: [], error: null }),
      },
    })
    await runOnce(client)
    const reserveCount = calls.filter(c => c.kind === 'rpc' && c.name === 'cn_psa_reserve_slots').length
    expect(reserveCount).toBe(1)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Candidate query — Pokemon-only + verified-only
// ──────────────────────────────────────────────────────────────────────

describe('selectBatch — enforces mapping_status=verified and site_key=pokeprices', () => {
  it('passes mapping_status=verified and site_key=pokeprices to both queries', async () => {
    const seenFilters: Record<string, unknown>[] = []
    const { client } = makeStub({
      selects: {
        cn_psa_candidates: (where) => { seenFilters.push({ ...where }); return { data: [], error: null } },
      },
    })
    await selectBatch(client, 5, 5, 'pokeprices')
    // Two queries (cohort + firstTimers) — both must carry the filters.
    expect(seenFilters.length).toBe(2)
    for (const f of seenFilters) {
      expect(f.site_key).toBe('pokeprices')
      expect(f.mapping_status).toBe('verified')
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// Config sanity — the plan math must respect the 90/day planned cap.
// ──────────────────────────────────────────────────────────────────────

describe('CONFIG — capacity-aware scheduling math', () => {
  it('cohort rotation slots per day ≈ priorityCohortSize / cohortRotationDays', () => {
    const slots = Math.ceil(CONFIG.priorityCohortSize / CONFIG.cohortRotationDays)
    expect(slots).toBe(34) // 1000 / 30 ≈ 33.3 → ceil 34
  })

  it('hard cap exceeds planned cap by a reasonable retry buffer', () => {
    expect(CONFIG.hardCap).toBeGreaterThan(CONFIG.plannedCap)
    expect(CONFIG.hardCap - CONFIG.plannedCap).toBeLessThanOrEqual(15)
  })

  it('batchTarget equals plannedCap so a single daily fire consumes full capacity', () => {
    // Pre-review bug: batchTarget was 45 while plannedCap was 90, so
    // a single daily fire reserved half the documented budget and
    // first-time coverage got only 11 slots instead of 56.
    expect(CONFIG.batchTarget).toBe(CONFIG.plannedCap)
    expect(CONFIG.batchTarget).toBeLessThanOrEqual(CONFIG.hardCap)
    // Derivation of 34 + 56 = 90:
    const cohortSlots = Math.ceil(CONFIG.priorityCohortSize / CONFIG.cohortRotationDays)
    const firstTimeSlots = CONFIG.batchTarget - cohortSlots
    expect(cohortSlots + firstTimeSlots).toBe(CONFIG.plannedCap)
    expect(firstTimeSlots).toBeGreaterThanOrEqual(50)   // documented ≈56
  })

  it('activeSiteKeys is Pokemon-only at bootstrap', () => {
    expect(CONFIG.activeSiteKeys).toEqual(['pokeprices'])
  })

  it('minCents exceeds $3 threshold (strict >)', () => {
    expect(CONFIG.minCents).toBeGreaterThan(300)
  })
})

// ──────────────────────────────────────────────────────────────────────
// Write-through — deterministic identity policy.
//
// Tests the SQL contract in the migration file. Running the RPC under
// an in-process Postgres is out of scope for this PR; instead these
// tests verify the SQL text contains the identity predicates and the
// review-queue insert path, so a future refactor can't accidentally
// loosen the policy.
// ──────────────────────────────────────────────────────────────────────

describe('cn_psa_writethrough_pokepop — deterministic identity policy', () => {
  it('migration defines the RPC with 5 parameters including identity fields', () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.cn_psa_writethrough_pokepop\([^)]*p_psa_spec_id[^)]*p_snapshot_date[^)]*p_candidate_set[^)]*p_candidate_num[^)]*p_candidate_var/s,
    )
  })

  it('UPDATE on psa_population is guarded by spec_id AND bare set_name AND card_number AND variant', () => {
    // The guard must appear in the UPDATE statement's WHERE clause.
    // We check the SQL file contains ALL identity predicates in a
    // contiguous block.
    const updateBlock = /UPDATE\s+public\.psa_population\s+pp[\s\S]*?WHERE\s+pp\.psa_spec_id\s*=\s*p_psa_spec_id[\s\S]*?regexp_replace\(pp\.set_name[\s\S]*?v_canon_set[\s\S]*?pp\.card_number[\s\S]*?v_canon_num[\s\S]*?pp\.variant[\s\S]*?v_canon_var/s
    expect(MIGRATION_SQL).toMatch(updateBlock)
  })

  it('legacy rows with matching spec_id but mismatched identity are counted into skipped', () => {
    const skipBlock = /SELECT\s+count\(\*\)\s+INTO\s+v_skipped[\s\S]*?psa_spec_id\s*=\s*p_psa_spec_id[\s\S]*?NOT\s*\(/s
    expect(MIGRATION_SQL).toMatch(skipBlock)
  })

  it('skipped legacy duplicates are enqueued into cn_psa_mapping_review', () => {
    expect(MIGRATION_SQL).toMatch(/INSERT INTO public\.cn_psa_mapping_review/)
    expect(MIGRATION_SQL).toMatch(/'legacy-dup:' \|\| pp\.id::text/)
    expect(MIGRATION_SQL).toMatch(/ON CONFLICT \(site_key, internal_id\) DO NOTHING/)
  })

  it('psa_pop_history append uses the same deterministic join as the UPDATE', () => {
    const histInsert = /INSERT INTO public\.psa_pop_history[\s\S]*?JOIN public\.psa_population pop[\s\S]*?regexp_replace\(pop\.set_name[\s\S]*?v_canon_set[\s\S]*?pop\.card_number[\s\S]*?v_canon_num[\s\S]*?pop\.variant[\s\S]*?v_canon_var/s
    expect(MIGRATION_SQL).toMatch(histInsert)
  })

  it('psa_pop_history append is idempotent on (spec_id, snapshot_date)', () => {
    expect(MIGRATION_SQL).toMatch(/NOT EXISTS[\s\S]*?psa_pop_history h[\s\S]*?psa_spec_id\s*=\s*p_psa_spec_id[\s\S]*?snapshot_date\s*=\s*p_snapshot_date/s)
  })

  it('RPC returns jsonb with the three audit fields the scheduler reads', () => {
    expect(MIGRATION_SQL).toMatch(/'updated'/)
    expect(MIGRATION_SQL).toMatch(/'skipped_legacy_dups'/)
    expect(MIGRATION_SQL).toMatch(/'history_appended'/)
  })
})

describe('refresh.ts — passes candidate identity to the write-through RPC', () => {
  beforeEach(() => {
    process.env['CN_PSA_REFRESH_ENABLED'] = '1'
    process.env['PSA_PUBLIC_API_TOKEN'] = 'tok'
  })

  it('writethrough call carries candidate set_name / card_number / variant', async () => {
    // Stub the batch returning ONE verified candidate. Stub the HTTP
    // fetch via node's global `fetch` by shadowing it on the module.
    // We can't easily intercept fetch here without spinning up a mock
    // server, so we stub at the Supabase level and watch the RPC args.
    const seenArgs: Record<string, unknown>[] = []
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ PSAPop: { SpecID: '855610', PSA10: 5, TotalPop: 10 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const candidate = {
      id: 7,
      site_key: 'pokeprices',
      internal_id: 'alakazam-expedition-1',
      psa_spec_id: '855610',
      raw_usd_cents: 12345,
      priority_rank: 1,
      last_refresh_success_at: null,
      set_name: 'Expedition',
      card_number: '1',
      variant: '',
    }
    const { client } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:            () => ({ data: true,  error: null }),
        cn_psa_reserve_slots:           () => ({ data: 1,     error: null }),
        cn_psa_recompute_priority:      () => ({ data: 1,     error: null }),
        cn_psa_writethrough_pokepop:    (args) => { seenArgs.push({ ...args }); return { data: { updated: 1, skipped_legacy_dups: 0, history_appended: 1 }, error: null } },
        cn_psa_release_lock:            () => ({ data: true,  error: null }),
        cn_psa_record_candidate_failure:() => ({ data: null,  error: null }),
      },
      selects: {
        // cohort query returns one candidate; firstTimers returns none
        // (the stub doesn't distinguish which call is which — it returns
        // the same for both; runOnce handles duplicate dedup via spec_id).
        cn_psa_candidates: () => ({ data: [candidate], error: null }),
      },
    })
    const r = await runOnce(client)
    expect(r.status === 'ok' || r.status === 'partial').toBe(true)
    // The write-through must have been called with identity fields.
    expect(seenArgs.length).toBeGreaterThanOrEqual(1)
    const args = seenArgs[0]!
    expect(args.p_psa_spec_id).toBe('855610')
    expect(args.p_candidate_set).toBe('Expedition')
    expect(args.p_candidate_num).toBe('1')
    expect(args.p_candidate_var).toBe('')
  })

  it('reports skipped_legacy_dups in the per-item error surface (non-fatal)', async () => {
    const candidate = {
      id: 8,
      site_key: 'pokeprices',
      internal_id: 'card-with-legacy-dups',
      psa_spec_id: '2466278',
      raw_usd_cents: 46200,
      priority_rank: 2,
      last_refresh_success_at: null,
      set_name: '1999 Topps Movie',
      card_number: '0',
      variant: 'Super Psychic Pokemon-Foil Promo',
    }
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ PSAPop: { SpecID: '2466278', PSA10: 122, TotalPop: 468 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const { client } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:            () => ({ data: true, error: null }),
        cn_psa_reserve_slots:           () => ({ data: 1,    error: null }),
        cn_psa_recompute_priority:      () => ({ data: 1,    error: null }),
        cn_psa_writethrough_pokepop:    () => ({ data: { updated: 1, skipped_legacy_dups: 1, history_appended: 1 }, error: null }),
        cn_psa_release_lock:            () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure:() => ({ data: null, error: null }),
      },
      selects: { cn_psa_candidates: () => ({ data: [candidate], error: null }) },
    })
    const r = await runOnce(client)
    // Success still counted, but the preserved legacy dup is surfaced.
    expect(r.successes).toBeGreaterThanOrEqual(1)
    const reportsDup = r.per_item_errors.some(e => e.error.includes('legacy duplicate'))
    expect(reportsDup).toBe(true)
  })
})
