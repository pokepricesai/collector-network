import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONFIG, runOnce, selectBatch,
  isPsaPayloadComplete, identityMatchesDescription,
} from '../refresh'

// Load the migration files once — several contract tests assert the
// RPC SQL honours the deterministic-identity + lifetime-budget policies.
const MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261105100000_cn0605_psa_refresh.sql'),
  'utf8',
)
const PILOT_MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261106120000_cn0605_psa_pilot.sql'),
  'utf8',
)

/** Default pilot config used by stubbed tests. Active + dry_run + 5 cap. */
const PILOT_DEFAULT = { active: true, lifetime_cap: 5, lifetime_attempts_used: 0, dry_run: true }

// This suite stubs @supabase/supabase-js by providing a hand-rolled client
// that records all table + rpc calls. It focuses on the scheduler's
// invariants without a live DB.

type FakeCall =
  | { kind: 'rpc'; name: string; args: Record<string, unknown> }
  | { kind: 'from'; table: string }
  | { kind: 'update'; table: string; patch: Record<string, unknown>; where: string[] }
  | { kind: 'upsert'; table: string; row: Record<string, unknown>; onConflict: string }

type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: unknown }
type SelectHandler = (where: Record<string, unknown>) => { data: unknown; error: unknown }

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
      const resolveSingle = () => {
        const handler = selects[table]
        if (handler) {
          const r = handler(where)
          const row = Array.isArray(r.data) ? (r.data[0] ?? null) : (r.data ?? null)
          return Promise.resolve({ data: row, error: r.error })
        }
        return Promise.resolve({ data: null, error: null })
      }
      const resolveMany = () => {
        const handler = selects[table]
        if (handler) {
          const r = handler(where)
          return Promise.resolve({ data: Array.isArray(r.data) ? r.data : (r.data == null ? [] : [r.data]), error: r.error })
        }
        return Promise.resolve({ data: [], error: null })
      }
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: unknown) => { where[col] = val; return chain },
        is: (col: string, val: unknown) => { where[col] = val; return chain },
        not: () => chain,
        gt: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => resolveMany(),
        maybeSingle: () => resolveSingle(),
        single: () => resolveSingle(),
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

/** Build a pilot-aware select handler. */
function pilotSelect(row: typeof PILOT_DEFAULT | null) {
  return (_where: Record<string, unknown>) => ({ data: row, error: null })
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
      selects: { cn_psa_pilot: pilotSelect(PILOT_DEFAULT) },
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
        cn_psa_pilot:      pilotSelect(PILOT_DEFAULT),
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
      selects: { cn_psa_pilot: pilotSelect(PILOT_DEFAULT) },
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
        cn_psa_pilot:      pilotSelect(PILOT_DEFAULT),
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
        cn_psa_pilot:      pilotSelect(PILOT_DEFAULT),
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
      JSON.stringify({
        SpecID: 855610,
        Description: 'POKEMON EXPEDITION #1 ALAKAZAM-HOLO',
        PSAPop: { Total: 10, Grade10: 5, Auth: 1 },
      }),
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
        cn_psa_pilot_reserve_attempt:   () => ({ data: true,  error: null }),
        cn_psa_writethrough_pokepop:    (args) => { seenArgs.push({ ...args }); return { data: { updated: 1, skipped_legacy_dups: 0, history_appended: 1 }, error: null } },
        cn_psa_release_lock:            () => ({ data: true,  error: null }),
        cn_psa_record_candidate_failure:() => ({ data: null,  error: null }),
      },
      selects: {
        // Pilot ACTIVE and dry_run=FALSE so the write-through actually fires.
        cn_psa_pilot:      pilotSelect({ ...PILOT_DEFAULT, dry_run: false }),
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
      JSON.stringify({
        SpecID: 2466278,
        Description: 'POKEMON 1999 TOPPS MOVIE #0 MEWTWO',
        PSAPop: { Total: 468, Grade10: 122, Auth: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const { client } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:            () => ({ data: true, error: null }),
        cn_psa_reserve_slots:           () => ({ data: 1,    error: null }),
        cn_psa_recompute_priority:      () => ({ data: 1,    error: null }),
        cn_psa_pilot_reserve_attempt:   () => ({ data: true, error: null }),
        cn_psa_writethrough_pokepop:    () => ({ data: { updated: 1, skipped_legacy_dups: 1, history_appended: 1 }, error: null }),
        cn_psa_release_lock:            () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure:() => ({ data: null, error: null }),
      },
      selects: {
        cn_psa_pilot:      pilotSelect({ ...PILOT_DEFAULT, dry_run: false }),
        cn_psa_candidates: () => ({ data: [candidate], error: null }),
      },
    })
    const r = await runOnce(client)
    // Success still counted, but the preserved legacy dup is surfaced.
    expect(r.successes).toBeGreaterThanOrEqual(1)
    const reportsDup = r.per_item_errors.some(e => e.error.includes('legacy duplicate'))
    expect(reportsDup).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────
// P04 pilot gate — lifetime budget + dry-run + identity + completeness
// ──────────────────────────────────────────────────────────────────────

describe('P04 pilot singleton gate', () => {
  beforeEach(() => {
    process.env['CN_PSA_REFRESH_ENABLED'] = '1'
    process.env['PSA_PUBLIC_API_TOKEN'] = 'tok'
  })

  it('exits pilot_inactive when the singleton row is absent', async () => {
    const { client, calls } = makeStub({
      selects: { cn_psa_pilot: pilotSelect(null) },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('pilot_inactive')
    // No lock, no reservation, no selectBatch, no fetch.
    const rpcs = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcs).not.toContain('cn_psa_acquire_lock')
    expect(rpcs).not.toContain('cn_psa_reserve_slots')
    expect(rpcs).not.toContain('cn_psa_pilot_reserve_attempt')
  })

  it('exits pilot_inactive when active = FALSE', async () => {
    const { client } = makeStub({
      selects: { cn_psa_pilot: pilotSelect({ ...PILOT_DEFAULT, active: false }) },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('pilot_inactive')
    expect(r.pilot_mode).toBe(false)
  })

  it('exits pilot_exhausted when used >= cap (pre-batch)', async () => {
    const { client } = makeStub({
      selects: { cn_psa_pilot: pilotSelect({ ...PILOT_DEFAULT, lifetime_attempts_used: 5 }) },
    })
    const r = await runOnce(client)
    expect(r.status).toBe('pilot_exhausted')
    expect(r.lifetime_cap).toBe(5)
    expect(r.lifetime_used_before).toBe(5)
  })

  it('halts mid-batch when cn_psa_pilot_reserve_attempt returns FALSE', async () => {
    // Two candidates in the batch. Reserve RPC returns true then false.
    let pilotCalls = 0
    const candidate1 = {
      id: 1, site_key: 'pokeprices', internal_id: 'a', psa_spec_id: '1',
      raw_usd_cents: 1000, priority_rank: 1, last_refresh_success_at: null,
      set_name: 'S', card_number: '1', variant: '',
    }
    const candidate2 = { ...candidate1, id: 2, internal_id: 'b', psa_spec_id: '2', card_number: '2' }
    const { client } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:             () => ({ data: true, error: null }),
        cn_psa_reserve_slots:            () => ({ data: 2,    error: null }),
        cn_psa_recompute_priority:       () => ({ data: 2,    error: null }),
        cn_psa_pilot_reserve_attempt:    () => { pilotCalls++; return { data: pilotCalls === 1, error: null } },
        cn_psa_release_lock:             () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure: () => ({ data: null, error: null }),
      },
      selects: {
        cn_psa_pilot:      pilotSelect(PILOT_DEFAULT),
        cn_psa_candidates: () => ({ data: [candidate1, candidate2], error: null }),
      },
    })
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({ SpecID: 1, Description: 'S #1', PSAPop: { Total: 1, Auth: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const r = await runOnce(client)
    expect(r.status).toBe('pilot_exhausted')
    // Only one fetch issued (the first pilot reserve was true, second was false).
    expect(r.requests_sent).toBe(1)
    expect(pilotCalls).toBe(2)
  })

  it('dry_run: writes to canonical tables but SKIPS legacy writethrough RPC', async () => {
    const candidate = {
      id: 10, site_key: 'pokeprices', internal_id: 'card-dry', psa_spec_id: '544023',
      raw_usd_cents: 9913, priority_rank: 1, last_refresh_success_at: null,
      set_name: 'Base Set', card_number: '2', variant: '',
    }
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:             () => ({ data: true, error: null }),
        cn_psa_reserve_slots:            () => ({ data: 1,    error: null }),
        cn_psa_recompute_priority:       () => ({ data: 1,    error: null }),
        cn_psa_pilot_reserve_attempt:    () => ({ data: true, error: null }),
        cn_psa_release_lock:             () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure: () => ({ data: null, error: null }),
      },
      selects: {
        cn_psa_pilot:      pilotSelect({ ...PILOT_DEFAULT, dry_run: true }),
        cn_psa_candidates: () => ({ data: [candidate], error: null }),
      },
    })
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        SpecID: 544023,
        Description: 'POKEMON BASE SET #2 BLASTOISE-HOLO',
        PSAPop: { Total: 48226, Grade10: 382, Auth: 120 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const r = await runOnce(client)
    expect(r.status).toBe('ok')
    expect(r.dry_run).toBe(true)
    expect(r.successes).toBe(1)
    // Canonical latest + history upserts present.
    const upserts = calls.filter(c => c.kind === 'upsert').map((c: any) => c.table)
    expect(upserts).toContain('cn_psa_pop_latest')
    expect(upserts).toContain('cn_psa_pop_history')
    // Legacy writethrough RPC must NOT have been called in dry_run.
    const rpcs = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcs).not.toContain('cn_psa_writethrough_pokepop')
  })

  it('identity mismatch (live mode): skips legacy writethrough even when dry_run=false', async () => {
    const candidate = {
      id: 11, site_key: 'pokeprices', internal_id: 'card-ident', psa_spec_id: '544023',
      raw_usd_cents: 9913, priority_rank: 1, last_refresh_success_at: null,
      set_name: 'Base Set', card_number: '2', variant: '',
    }
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:             () => ({ data: true, error: null }),
        cn_psa_reserve_slots:            () => ({ data: 1,    error: null }),
        cn_psa_recompute_priority:       () => ({ data: 1,    error: null }),
        cn_psa_pilot_reserve_attempt:    () => ({ data: true, error: null }),
        cn_psa_release_lock:             () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure: () => ({ data: null, error: null }),
      },
      selects: {
        cn_psa_pilot:      pilotSelect({ ...PILOT_DEFAULT, dry_run: false }),
        cn_psa_candidates: () => ({ data: [candidate], error: null }),
      },
    })
    // Description matches a DIFFERENT card than the candidate.
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        SpecID: 544023,
        Description: 'POKEMON JUNGLE #15 VENUSAUR-HOLO',
        PSAPop: { Total: 1000, Grade10: 50, Auth: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const r = await runOnce(client)
    expect(r.status).toBe('ok')
    // Canonical write still occurs (for operator inspection) but legacy
    // writethrough is suppressed by the identity guard.
    const rpcs = calls.filter(c => c.kind === 'rpc').map(c => c.name)
    expect(rpcs).not.toContain('cn_psa_writethrough_pokepop')
    const identitySurfaced = r.per_item_errors.some(e => e.error.startsWith('identity:'))
    expect(identitySurfaced).toBe(true)
    expect(r.per_item_identity_checks[0]?.identity_ok).toBe(false)
  })

  it('completeness check: rejects PSA response with no Total and no numeric grades', async () => {
    const candidate = {
      id: 12, site_key: 'pokeprices', internal_id: 'card-incomplete', psa_spec_id: '12345',
      raw_usd_cents: 500, priority_rank: 1, last_refresh_success_at: null,
      set_name: 'Base Set', card_number: '2', variant: '',
    }
    const { client, calls } = makeStub({
      rpcs: {
        cn_psa_acquire_lock:             () => ({ data: true, error: null }),
        cn_psa_reserve_slots:            () => ({ data: 1,    error: null }),
        cn_psa_recompute_priority:       () => ({ data: 1,    error: null }),
        cn_psa_pilot_reserve_attempt:    () => ({ data: true, error: null }),
        cn_psa_release_lock:             () => ({ data: true, error: null }),
        cn_psa_record_candidate_failure: () => ({ data: null, error: null }),
      },
      selects: {
        cn_psa_pilot:      pilotSelect({ ...PILOT_DEFAULT, dry_run: false }),
        cn_psa_candidates: () => ({ data: [candidate], error: null }),
      },
    })
    // Response has Auth present (structural valid) but no Total.
    const stubFetch: typeof fetch = async () => new Response(
      JSON.stringify({
        SpecID: 12345,
        Description: 'POKEMON BASE SET #2 BLASTOISE',
        PSAPop: { Auth: 3 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
    globalThis.fetch = stubFetch as unknown as typeof fetch

    const r = await runOnce(client)
    // Response WAS fetched (pilot slot consumed), but refused persistence.
    expect(r.requests_sent).toBe(1)
    expect(r.failures).toBe(1)
    expect(r.successes).toBe(0)
    // No pop writes.
    const upserts = calls.filter(c => c.kind === 'upsert').map((c: any) => c.table)
    expect(upserts).not.toContain('cn_psa_pop_latest')
    expect(upserts).not.toContain('cn_psa_pop_history')
    const reasons = r.per_item_errors.map(e => e.error)
    expect(reasons.some(x => x.startsWith('incomplete:'))).toBe(true)
  })
})

describe('isPsaPayloadComplete', () => {
  const base = {
    auth: null, psa_1: null, psa_1_5: null, psa_2: null, psa_2_5: null,
    psa_3: null, psa_3_5: null, psa_4: null, psa_4_5: null,
    psa_5: null, psa_5_5: null, psa_6: null, psa_6_5: null,
    psa_7: null, psa_7_5: null, psa_8: null, psa_8_5: null,
    psa_9: null, psa_9_5: null, psa_10: null,
    qualified_total: null, total_graded: null, gem_rate: null,
  }
  it('rejects when total_graded is null', () => {
    expect(isPsaPayloadComplete({ ...base, psa_10: 5 })).toBe(false)
  })
  it('rejects when total_graded > 0 but no numeric grade or auth', () => {
    expect(isPsaPayloadComplete({ ...base, total_graded: 100 })).toBe(false)
  })
  it('accepts when total_graded > 0 and some grade is numeric', () => {
    expect(isPsaPayloadComplete({ ...base, total_graded: 100, psa_10: 5 })).toBe(true)
  })
  it('accepts a legitimate Total=0 factual zero', () => {
    expect(isPsaPayloadComplete({ ...base, total_graded: 0 })).toBe(true)
  })
})

describe('identityMatchesDescription', () => {
  it('accepts when bare set + number both appear in description', () => {
    expect(identityMatchesDescription(
      'POKEMON BASE SET #2 BLASTOISE-HOLO',
      { set_name: 'Base Set', card_number: '2' },
    )).toBe(true)
  })
  it('strips "Pokemon " prefix from candidate set', () => {
    expect(identityMatchesDescription(
      'POKEMON BASE SET #2 BLASTOISE',
      { set_name: 'Pokemon Base Set', card_number: '2' },
    )).toBe(true)
  })
  it('rejects when set is wrong', () => {
    expect(identityMatchesDescription(
      'POKEMON JUNGLE #15 VENUSAUR',
      { set_name: 'Base Set', card_number: '15' },
    )).toBe(false)
  })
  it('rejects when number is absent', () => {
    expect(identityMatchesDescription(
      'POKEMON BASE SET BLASTOISE',
      { set_name: 'Base Set', card_number: '2' },
    )).toBe(false)
  })
  it('rejects null description', () => {
    expect(identityMatchesDescription(null, { set_name: 'x', card_number: '1' })).toBe(false)
  })
})

describe('P04 security migration — RLS + REVOKE + GRANT', () => {
  const SEC_MIGRATION_SQL = readFileSync(
    join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261106130000_cn0605_psa_security.sql'),
    'utf8',
  )
  it('enables RLS on every cn_psa_* table', () => {
    for (const t of [
      'cn_psa_candidates', 'cn_psa_pop_latest', 'cn_psa_pop_history',
      'cn_psa_api_usage', 'cn_psa_mapping_review', 'cn_psa_pilot',
    ]) {
      expect(SEC_MIGRATION_SQL).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    }
  })
  it('REVOKEs EXECUTE on cn_psa_pilot_arm from anon + authenticated + PUBLIC', () => {
    expect(SEC_MIGRATION_SQL).toMatch(/REVOKE ALL ON FUNCTION public\.cn_psa_pilot_arm[^;]*FROM PUBLIC,\s*anon,\s*authenticated/)
  })
  it('GRANTs EXECUTE on cn_psa_pilot_arm to service_role', () => {
    expect(SEC_MIGRATION_SQL).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.cn_psa_pilot_arm[^;]*TO service_role/)
  })
  it('locks down every PSA RPC function (8 functions)', () => {
    const fns = [
      'cn_psa_reserve_slots', 'cn_psa_acquire_lock', 'cn_psa_release_lock',
      'cn_psa_record_candidate_failure', 'cn_psa_recompute_priority',
      'cn_psa_writethrough_pokepop',
      'cn_psa_pilot_reserve_attempt', 'cn_psa_pilot_arm',
    ]
    for (const f of fns) {
      expect(SEC_MIGRATION_SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}`))
      expect(SEC_MIGRATION_SQL).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${f}[^;]*TO service_role`))
    }
  })
})

describe('P04 migration — pilot singleton + RPCs declared', () => {
  it('migration defines cn_psa_pilot singleton with id=TRUE constraint', () => {
    expect(PILOT_MIGRATION_SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.cn_psa_pilot/)
    expect(PILOT_MIGRATION_SQL).toMatch(/cn_psa_pilot_singleton_ck CHECK \(id = TRUE\)/)
  })
  it('migration defines cn_psa_pilot_reserve_attempt with FOR UPDATE row lock', () => {
    expect(PILOT_MIGRATION_SQL).toMatch(/FUNCTION public\.cn_psa_pilot_reserve_attempt/)
    expect(PILOT_MIGRATION_SQL).toMatch(/FOR UPDATE/)
  })
  it('migration auto-flips active=FALSE on exhaustion', () => {
    expect(PILOT_MIGRATION_SQL).toMatch(/active\s*=\s*FALSE[\s\S]{0,200}last_status\s*=\s*'exhausted'/)
  })
  it('migration admin RPC refuses lifetime_cap > 5', () => {
    expect(PILOT_MIGRATION_SQL).toMatch(/p_lifetime_cap.*>.*5/)
  })
})
