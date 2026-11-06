import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { runDelivery } from '../deliver'
import * as discord from '../discord'
import type { OutboxRow } from '../types'

// CN-STOCK-02 · outbox delivery tests.
//
// These exercise the retry / backoff / permanent-fail / ambiguous-
// timeout decision paths with a mocked Supabase client and a stubbed
// sendDiscord(). No real HTTP; no real DB.

function makeOutboxRow(partial: Partial<OutboxRow> = {}): OutboxRow {
  // Use normalised ISO with millis so string-order comparisons match
  // what Supabase emits (new Date().toISOString() always yields .sssZ).
  return {
    id: partial.id ?? 'outbox-1',
    event_id: partial.event_id ?? 'event-1',
    target: partial.target ?? 'discord:test',
    idempotency_key: partial.idempotency_key ?? 'event-1',
    payload: partial.payload ?? { content: '**RESTOCK DETECTED**\n…' },
    status: partial.status ?? 'pending',
    attempt_count: partial.attempt_count ?? 0,
    max_attempts: partial.max_attempts ?? 5,
    next_attempt_at: partial.next_attempt_at ?? '2026-11-07T09:00:00.000Z',
    last_attempted_at: partial.last_attempted_at ?? null,
    delivered_at: partial.delivered_at ?? null,
    last_error: partial.last_error ?? null,
    created_at: partial.created_at ?? '2026-11-07T09:00:00.000Z',
    updated_at: partial.updated_at ?? '2026-11-07T09:00:00.000Z',
  }
}

/** Hand-rolled Supabase client stub. Same pattern used elsewhere
 *  in Hub tests (PSA refresh, releases ingester). */
function makeSb(initial: OutboxRow[] = []) {
  const rows = [...initial]
  const updates: Array<{ id: string; patch: Partial<OutboxRow> }> = []
  const sb = {
    from(table: string) {
      return {
        select(_fields: string) {
          const chain: {
            _filters: { in?: [string, unknown[]]; lte?: [string, unknown] }
            in(col: string, values: unknown[]): typeof chain
            lte(col: string, value: unknown): typeof chain
            order(_col: string, _opts?: unknown): typeof chain
            limit(_n: number): Promise<{ data: OutboxRow[]; error: null }>
          } = {
            _filters: {},
            in(col, values) { chain._filters.in = [col, values]; return chain },
            lte(col, value) { chain._filters.lte = [col, value]; return chain },
            order() { return chain },
            limit(_n) {
              if (table !== 'cn_stock_outbox') return Promise.resolve({ data: [], error: null })
              const statuses = chain._filters.in?.[1] as string[] | undefined
              const lteCol = chain._filters.lte?.[0] as string | undefined
              const lteVal = chain._filters.lte?.[1] as string | undefined
              let matching = rows
              if (statuses) matching = matching.filter((r) => statuses.includes(r.status))
              if (lteCol === 'next_attempt_at' && lteVal) matching = matching.filter((r) => r.next_attempt_at <= lteVal)
              // Clone so the caller's reference doesn't track in-place
              // UPDATE mutations — real Postgres doesn't auto-sync the
              // SELECTed row with subsequent UPDATEs.
              const cloned = matching.slice(0, _n).map((r) => ({ ...r }))
              return Promise.resolve({ data: cloned, error: null })
            },
          }
          return chain
        },
        update(patch: Partial<OutboxRow>) {
          // Simulates PostgREST .update(patch).eq(col, val)[.eq(col2, val2)][.select(...).maybeSingle()]
          const filters: Record<string, unknown> = {}
          let applied = false
          function applyUpdate(): { row: OutboxRow | undefined } {
            if (applied) {
              const id = filters.id as string | undefined
              return { row: id ? rows.find((r) => r.id === id) : undefined }
            }
            applied = true
            const id = filters.id as string | undefined
            if (!id) return { row: undefined }
            const row = rows.find((r) => r.id === id)
            if (!row) return { row: undefined }
            // CAS: if filter includes status, enforce it before writing.
            if (typeof filters.status === 'string' && row.status !== filters.status) return { row: undefined }
            updates.push({ id, patch })
            Object.assign(row, patch)
            return { row }
          }
          type Chain = PromiseLike<{ error: null }> & {
            eq(col: string, val: unknown): Chain
            select(fields: string): { maybeSingle(): Promise<{ data: { id: string } | null; error: null }> }
          }
          const chain: Chain = {
            eq(col, val) {
              filters[col] = val
              return chain
            },
            select(_fields) {
              return {
                maybeSingle() {
                  const { row } = applyUpdate()
                  return Promise.resolve({ data: row ? { id: row.id } : null, error: null })
                },
              }
            },
            then<TResult1 = { error: null }, TResult2 = never>(
              onFulfilled?: ((value: { error: null }) => TResult1 | PromiseLike<TResult1>) | null,
              onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ): PromiseLike<TResult1 | TResult2> {
              applyUpdate()
              return Promise.resolve<{ error: null }>({ error: null }).then(onFulfilled as never, onRejected as never)
            },
          }
          return chain
        },
      }
    },
  }
  return { sb: sb as unknown as Parameters<typeof runDelivery>[0], rows, updates }
}

describe('runDelivery · success path', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('delivered → row marked delivered, delivered_at set, no retry', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1' })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({ kind: 'delivered', status_code: 204 })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.delivered).toBe(1)
    expect(s.processed).toBe(1)
    expect(rows[0]!.status).toBe('delivered')
    expect(rows[0]!.delivered_at).toBeTruthy()
    expect(rows[0]!.attempt_count).toBe(1)
  })
})

describe('runDelivery · retryable paths', () => {
  it('429 with Retry-After: schedules next attempt per header', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1' })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'retryable', status_code: 429, retry_after_ms: 30_000, summary: '429 rate_limited',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.retryable).toBe(1)
    expect(rows[0]!.status).toBe('failed_retryable')
    expect(rows[0]!.next_attempt_at).toBe('2026-11-07T10:00:30.000Z')
    expect(rows[0]!.last_error).toMatch(/429/)
  })

  it('5xx without retry-after: uses exponential backoff', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1' })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'retryable', status_code: 503, retry_after_ms: null, summary: '503 server_error',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.retryable).toBe(1)
    expect(rows[0]!.status).toBe('failed_retryable')
    // First retry = 2 minutes (second attempt in schedule for attempt_count=1).
    expect(rows[0]!.next_attempt_at).toBe('2026-11-07T10:02:00.000Z')
  })

  it('retry budget exhausted → failed_permanent', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1', attempt_count: 4, max_attempts: 5 })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'retryable', status_code: 503, retry_after_ms: null, summary: '503 server_error',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.permanent).toBe(1)
    expect(rows[0]!.status).toBe('failed_permanent')
    expect(rows[0]!.last_error).toMatch(/retry budget exhausted/)
  })
})

describe('runDelivery · ambiguous timeout handling', () => {
  it('client timeout does NOT retry (brief: ambiguous-send)', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1' })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'timeout_ambiguous', summary: 'client timeout',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.ambiguous).toBe(1)
    expect(rows[0]!.status).toBe('timeout_ambiguous')
    expect(rows[0]!.last_error).toMatch(/timeout/)
    // No next_attempt_at advance — this is terminal.
  })
})

describe('runDelivery · webhook config missing', () => {
  it('config_missing preserves attempt_count and schedules a soft retry', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1', attempt_count: 0 })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'config_missing', summary: 'env var for discord:test not set',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.skipped_config_missing).toBe(1)
    expect(rows[0]!.status).toBe('pending')
    expect(rows[0]!.attempt_count).toBe(0)  // not incremented permanently
    expect(rows[0]!.next_attempt_at).toBe('2026-11-07T10:05:00.000Z')
  })
})

describe('runDelivery · permanent client errors', () => {
  it('401/404 → failed_permanent, no retries', async () => {
    const { sb, rows } = makeSb([makeOutboxRow({ id: 'o1' })])
    vi.spyOn(discord, 'sendDiscord').mockResolvedValue({
      kind: 'permanent', status_code: 401, summary: '401 unauthorized',
    })
    const s = await runDelivery(sb, { now: new Date('2026-11-07T10:00:00Z') })
    expect(s.permanent).toBe(1)
    expect(rows[0]!.status).toBe('failed_permanent')
  })
})

describe('buildPayload · message shape', () => {
  it('includes all required fields with price', () => {
    const payload = discord.buildPayload(
      {
        detected_at: '2026-11-07T10:15:00.123Z',
        price: 219.97, currency: 'USD',
        evidence_summary: 'Offer.availability=InStock',
      },
      {
        retailer: 'game_nerdz', country: 'US', game: 'mtg',
        product_name: 'Magic: The Gathering Throne of Eldraine Booster Box',
        variant: 'booster_box',
        url: 'https://www.gamenerdz.com/magic-the-gathering-throne-of-eldraine-booster-box',
      },
    )
    expect(payload.content).toMatch(/RESTOCK DETECTED/)
    expect(payload.content).toMatch(/Magic: The Gathering/)
    expect(payload.content).toMatch(/Throne of Eldraine/)
    expect(payload.content).toMatch(/game nerdz · US/)
    expect(payload.content).toMatch(/USD 219\.97/)
    expect(payload.content).toMatch(/Back in stock/)
    expect(payload.content).toMatch(/2026-11-07 10:15:00Z/)
    expect(payload.content).toMatch(/www\.gamenerdz\.com\/magic-the-gathering-throne-of-eldraine-booster-box/)
  })

  it('shows "Not displayed" when price is null', () => {
    const payload = discord.buildPayload(
      { detected_at: '2026-11-07T10:00:00Z', price: null, currency: null, evidence_summary: null },
      { retailer: 'miniature_market', country: 'US', game: 'mtg', product_name: 'Example Product', variant: null, url: 'https://example.com/p' },
    )
    expect(payload.content).toMatch(/Price: Not displayed/)
  })
})

afterEach(() => vi.restoreAllMocks())
