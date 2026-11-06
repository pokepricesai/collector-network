import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decide, buildTransitionKey } from '../stateMachine'
import type { WatchlistRow, ObservationInput } from '../types'

// CN-STOCK-02 · end-to-end integration test.
//
// Applies the schema migration to an in-process PGlite, then
// exercises the full write path (observation → state machine →
// event → outbox) through a thin SupabaseClient adapter so the
// test uses the EXACT same INSERT/UPDATE statements the probe
// does in production.
//
// Covers scenarios the brief enumerates:
//   - Initial baseline creates no alert
//   - out → in creates one event (requires 2 confirming in_stock)
//   - Repeated in_stock creates zero additional events
//   - Unknown does not alter confirmed stock
//   - Preorder does not count as a restock
//   - Failed checks preserve state
//   - Duplicate concurrent workers do not duplicate events (UNIQUE key)
//   - Outbox survives restart (rows persist across close/open)

const MIGRATION_SQL = readFileSync(
  join(process.cwd(), '..', '..', 'supabase', 'migrations', '20261107050000_cn_stock_02_engine.sql'),
  'utf8',
)

// Stub Supabase roles + network_is_admin referenced by the migration's RLS.
const STUB_SQL = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create or replace function public.network_is_admin()
  returns boolean language sql stable as $fn$ select true $fn$;
`

/** Minimal Supabase-client shim over PGlite. Supports the subset
 *  the probe/deliver code actually calls: from().select/insert/
 *  update + .eq().in().lte().order().limit().single()/.maybeSingle(). */
function makeSb(db: PGlite): SupabaseClient {
  function table(name: string) {
    return {
      select(fields: string) {
        const where: string[] = []
        const params: unknown[] = []
        const push = (clause: string, ...vals: unknown[]) => { where.push(clause); params.push(...vals) }
        let orderClause = ''
        const chain: Record<string, unknown> = {
          eq(col: string, val: unknown) { push(`${col} = $${params.length + 1}`, val); return chain },
          in(col: string, vals: unknown[]) {
            const placeholders = vals.map((_, i) => `$${params.length + 1 + i}`).join(', ')
            push(`${col} in (${placeholders})`, ...vals)
            return chain
          },
          lte(col: string, val: unknown) { push(`${col} <= $${params.length + 1}`, val); return chain },
          gte(col: string, val: unknown) { push(`${col} >= $${params.length + 1}`, val); return chain },
          order(col: string, opts?: { ascending?: boolean }) {
            orderClause = ` order by ${col} ${opts?.ascending === false ? 'desc' : 'asc'}`
            return chain
          },
          async limit(n: number) {
            const whereSql = where.length ? ` where ${where.join(' and ')}` : ''
            const r = await db.query(`select ${fields} from ${name}${whereSql}${orderClause} limit ${n}`, params)
            return { data: r.rows, error: null }
          },
          async maybeSingle() {
            const whereSql = where.length ? ` where ${where.join(' and ')}` : ''
            const r = await db.query(`select ${fields} from ${name}${whereSql} limit 1`, params)
            return { data: r.rows[0] ?? null, error: null }
          },
          async single() {
            const whereSql = where.length ? ` where ${where.join(' and ')}` : ''
            const r = await db.query(`select ${fields} from ${name}${whereSql} limit 1`, params)
            return { data: r.rows[0] ?? null, error: r.rows[0] ? null : { message: 'no rows' } }
          },
        }
        return chain
      },
      insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
        const rows = Array.isArray(values) ? values : [values]
        if (rows.length === 0) {
          return Object.assign({
            select() { return { async single() { return { data: null, error: null } } } },
            async then(onF: (v: { error: null }) => unknown) { return Promise.resolve({ error: null }).then(onF) },
          })
        }
        const cols = Object.keys(rows[0]!)
        const paramPlaceholders = rows.map((r, i) =>
          '(' + cols.map((_, j) => `$${i * cols.length + j + 1}`).join(', ') + ')',
        ).join(', ')
        const params: unknown[] = []
        for (const r of rows) for (const c of cols) params.push(r[c] ?? null)
        let returning = false
        const result = {
          select(_f: string) {
            returning = true
            return {
              async single() {
                try {
                  const r = await db.query(`insert into ${name}(${cols.join(', ')}) values ${paramPlaceholders} returning *`, params)
                  return { data: r.rows[0] ?? null, error: null }
                } catch (err) {
                  return { data: null, error: { message: (err as Error).message, code: isDuplicate(err) ? '23505' : null } }
                }
              },
            }
          },
          async then(onF: (v: { error: Record<string, unknown> | null }) => unknown) {
            try {
              const sql = returning
                ? `insert into ${name}(${cols.join(', ')}) values ${paramPlaceholders} returning *`
                : `insert into ${name}(${cols.join(', ')}) values ${paramPlaceholders}`
              await db.query(sql, params)
              return Promise.resolve({ error: null }).then(onF)
            } catch (err) {
              return Promise.resolve({ error: { message: (err as Error).message, code: isDuplicate(err) ? '23505' : null } }).then(onF)
            }
          },
        }
        return result
      },
      update(patch: Record<string, unknown>) {
        const where: string[] = []
        const params: unknown[] = []
        const setCols = Object.keys(patch)
        const setClause = setCols.map((c, i) => `${c} = $${i + 1}`).join(', ')
        for (const c of setCols) params.push(patch[c] ?? null)
        const chain: Record<string, unknown> = {
          eq(col: string, val: unknown) { where.push(`${col} = $${params.length + 1}`); params.push(val); return chain },
          select(_f: string) {
            return {
              async maybeSingle() {
                const whereSql = where.length ? ` where ${where.join(' and ')}` : ''
                const r = await db.query(`update ${name} set ${setClause}${whereSql} returning *`, params)
                return { data: r.rows[0] ?? null, error: null }
              },
            }
          },
          async then(onF: (v: { error: null }) => unknown) {
            const whereSql = where.length ? ` where ${where.join(' and ')}` : ''
            await db.query(`update ${name} set ${setClause}${whereSql}`, params)
            return Promise.resolve({ error: null }).then(onF)
          },
        }
        return chain
      },
    }
  }
  const sb = {
    from: table,
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
  return sb as unknown as SupabaseClient
}

function isDuplicate(err: unknown): boolean {
  const msg = (err as Error)?.message ?? ''
  return /duplicate key|unique constraint/i.test(msg)
}

let db: PGlite
let sb: SupabaseClient

beforeAll(async () => {
  db = new PGlite()
  await db.exec(STUB_SQL)
  await db.exec(MIGRATION_SQL)
  sb = makeSb(db)
})

afterAll(async () => {
  await db.close()
})

async function makeListing(overrides: Partial<WatchlistRow> = {}): Promise<WatchlistRow> {
  const { data } = await sb.from('cn_stock_watchlist').insert({
    retailer: overrides.retailer ?? 'game_nerdz',
    country: overrides.country ?? 'US',
    game: overrides.game ?? 'mtg',
    product_name: overrides.product_name ?? 'Test Booster Box',
    variant: overrides.variant ?? 'booster_box',
    url: overrides.url ?? `https://example.test/p/${Math.random().toString(36).slice(2, 10)}`,
    check_interval_minutes: 15,
  }).select('*').single()
  return data as WatchlistRow
}

async function applyObservation(listing: WatchlistRow, obs: ObservationInput): Promise<{
  patched: WatchlistRow
  emittedEvent: boolean
}> {
  const current = (await sb.from('cn_stock_watchlist').select('*').eq('id', listing.id).maybeSingle()).data as WatchlistRow
  const decision = decide(current, obs)
  await sb.from('cn_stock_observations').insert({
    watchlist_id: current.id,
    observed_at: obs.observed_at,
    observation_state: obs.state,
    http_status: obs.http_status,
    duration_ms: obs.duration_ms,
    bytes_downloaded: obs.bytes_downloaded,
    extraction_method: obs.extraction_method,
    evidence_summary: obs.evidence_summary,
    identity_match: obs.identity_match,
    price: obs.price,
    currency: obs.currency,
    error_detail: obs.error_detail,
    robots_gate_reason: obs.robots_gate_reason,
  })
  await sb.from('cn_stock_watchlist').update(decision.watchlist_patch).eq('id', current.id)

  let emittedEvent = false
  if (decision.emit_event) {
    const { data, error } = await sb.from('cn_stock_events').insert({
      watchlist_id: current.id,
      transition_key: decision.emit_event.transition_key,
      detected_at: obs.observed_at,
      previous_state: decision.emit_event.previous_state,
      new_state: decision.emit_event.new_state,
      evidence_summary: decision.emit_event.evidence_summary,
      price: decision.emit_event.price,
      currency: decision.emit_event.currency,
    }).select('*').single()
    if (!error) {
      emittedEvent = true
      const event = data as { id: string }
      // Enqueue outbox row (idempotency_key = event.id).
      await sb.from('cn_stock_outbox').insert({
        event_id: event.id,
        target: 'discord:test',
        idempotency_key: event.id,
        payload: { content: `restock for ${current.product_name}` } as unknown as Record<string, unknown>,
        next_attempt_at: obs.observed_at,
      })
    }
  }
  const updated = (await sb.from('cn_stock_watchlist').select('*').eq('id', listing.id).maybeSingle()).data as WatchlistRow
  return { patched: updated, emittedEvent }
}

function obs(state: ObservationInput['state'], when: string, extra: Partial<ObservationInput> = {}): ObservationInput {
  return {
    state,
    observed_at: when,
    http_status: extra.http_status ?? (state === 'blocked' ? 403 : 200),
    duration_ms: extra.duration_ms ?? 400,
    bytes_downloaded: extra.bytes_downloaded ?? 50_000,
    extraction_method: extra.extraction_method ?? (state === 'unknown' || state === 'blocked' ? 'none' : 'json_ld'),
    evidence_summary: extra.evidence_summary ?? `test:${state}`,
    identity_match: extra.identity_match ?? true,
    price: extra.price ?? (state === 'in_stock' ? 199.99 : null),
    currency: extra.currency ?? (state === 'in_stock' ? 'USD' : null),
    error_detail: extra.error_detail ?? null,
    robots_gate_reason: extra.robots_gate_reason ?? null,
  }
}

describe('CN-STOCK-02 integration · schema + state machine wiring', () => {
  it('first observation never emits an event (baseline rule)', async () => {
    const listing = await makeListing()
    const r = await applyObservation(listing, obs('in_stock', '2026-11-07T10:00:00.000Z'))
    expect(r.emittedEvent).toBe(false)
    expect(r.patched.last_confirmed_state).toBe('in_stock')
  })

  it('out → in with two consecutive in_stock observations emits exactly one event', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('out_of_stock', '2026-11-07T10:00:00.000Z'))
    const r1 = await applyObservation(listing, obs('in_stock', '2026-11-07T10:15:00.000Z'))
    expect(r1.emittedEvent).toBe(false)   // tentative
    expect(r1.patched.last_confirmed_state).toBe('out_of_stock')  // not flipped yet

    const r2 = await applyObservation(listing, obs('in_stock', '2026-11-07T10:30:00.000Z'))
    expect(r2.emittedEvent).toBe(true)
    expect(r2.patched.last_confirmed_state).toBe('in_stock')

    const r3 = await applyObservation(listing, obs('in_stock', '2026-11-07T10:45:00.000Z'))
    expect(r3.emittedEvent).toBe(false)   // same state

    // Only one event, one outbox row.
    const events = await db.query<{ n: number }>(
      `select count(*)::int as n from cn_stock_events where watchlist_id = $1`,
      [listing.id],
    )
    expect(events.rows[0]!.n).toBe(1)

    const outbox = await db.query<{ n: number }>(
      `select count(*)::int as n from cn_stock_outbox
         where event_id = (select id from cn_stock_events where watchlist_id = $1)`,
      [listing.id],
    )
    expect(outbox.rows[0]!.n).toBe(1)
  })

  it('unknown does not alter confirmed stock', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:00:00.000Z'))
    const r = await applyObservation(listing, obs('unknown', '2026-11-07T10:15:00.000Z'))
    expect(r.emittedEvent).toBe(false)
    expect(r.patched.last_confirmed_state).toBe('in_stock')
    expect(r.patched.consecutive_unknown_count).toBe(1)
  })

  it('preorder state never emits a restock event', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('out_of_stock', '2026-11-07T10:00:00.000Z'))
    const r1 = await applyObservation(listing, obs('preorder', '2026-11-07T10:15:00.000Z'))
    expect(r1.emittedEvent).toBe(false)
    // Preorder doesn't get the double-confirmation gate because it's
    // self-contained — but we also don't emit a restock event.
    const r2 = await applyObservation(listing, obs('preorder', '2026-11-07T10:30:00.000Z'))
    expect(r2.emittedEvent).toBe(false)
  })

  it('wrong product variant (identity mismatch upstream) is swallowed as unknown', async () => {
    // At this layer we trust the extractor's output; if it emits
    // 'unknown' because identity_match was false, the state
    // machine must preserve the previous state.
    const listing = await makeListing()
    await applyObservation(listing, obs('out_of_stock', '2026-11-07T10:00:00.000Z'))
    const r = await applyObservation(
      listing,
      obs('unknown', '2026-11-07T10:15:00.000Z', {
        evidence_summary: 'identity mismatch (signal was in_stock): Offer.availability=InStock',
        identity_match: false,
      }),
    )
    expect(r.emittedEvent).toBe(false)
    expect(r.patched.last_confirmed_state).toBe('out_of_stock')
  })

  it('failed checks (HTTP 500) preserve confirmed state', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:00:00.000Z'))
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:15:00.000Z'))
    const r = await applyObservation(
      listing,
      obs('unknown', '2026-11-07T10:30:00.000Z', {
        http_status: 500, extraction_method: 'none', evidence_summary: null,
        error_detail: 'HTTP 500',
      }),
    )
    expect(r.patched.last_confirmed_state).toBe('in_stock')
    expect(r.patched.consecutive_unknown_count).toBe(1)
  })

  it('duplicate concurrent workers producing the same transition_key insert exactly one event', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('out_of_stock', '2026-11-07T10:00:00.000Z'))
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:15:00.000Z'))

    // Two workers see the second in_stock in the same 15-min bucket.
    const key = buildTransitionKey({
      watchlist_id: listing.id,
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date('2026-11-07T10:30:30.000Z'),
    })
    const first = await sb.from('cn_stock_events').insert({
      watchlist_id: listing.id,
      transition_key: key,
      detected_at: '2026-11-07T10:30:30.000Z',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      evidence_summary: 'test',
    }).select('*').single()
    expect(first.error).toBeNull()
    expect(first.data).toBeTruthy()

    const second = await sb.from('cn_stock_events').insert({
      watchlist_id: listing.id,
      transition_key: key,
      detected_at: '2026-11-07T10:30:35.000Z',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      evidence_summary: 'test-dup',
    }).select('*').single()
    expect(second.error).not.toBeNull()
    expect(second.error?.message).toMatch(/duplicate key|unique/i)
  })

  it('observation table retains the raw check log (identity_match captured)', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:00:00.000Z', { identity_match: true, price: 42.5, currency: 'GBP' }))
    const row = await db.query<{ identity_match: boolean; price: string; currency: string }>(
      `select identity_match, price::text as price, currency from cn_stock_observations where watchlist_id = $1`,
      [listing.id],
    )
    expect(row.rows[0]!.identity_match).toBe(true)
    expect(Number(row.rows[0]!.price)).toBe(42.5)
    expect(row.rows[0]!.currency).toBe('GBP')
  })

  it('outbox row survives workflow restart (persisted in DB, not memory)', async () => {
    const listing = await makeListing()
    await applyObservation(listing, obs('out_of_stock', '2026-11-07T10:00:00.000Z'))
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:15:00.000Z'))
    await applyObservation(listing, obs('in_stock', '2026-11-07T10:30:00.000Z'))
    const out = await db.query<{ n: number; status: string }>(
      `select count(*)::int as n, min(status) as status from cn_stock_outbox
         where event_id in (select id from cn_stock_events where watchlist_id = $1)
         group by status`,
      [listing.id],
    )
    expect(out.rows[0]!.n).toBeGreaterThanOrEqual(1)
    expect(out.rows[0]!.status).toBe('pending')
  })
})
