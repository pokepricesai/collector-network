import { describe, it, expect } from 'vitest'

// CN-06.06 corrections · executable tests for the ingester's
// review-gate state machine. Companion SQL-contract tests for
// the migration itself live on the PR #7 branch
// (apps/hub/src/server/releases/__tests__/review-gate.test.ts).
//
// Pattern follows the PSA refresh test suite — a hand-rolled
// Supabase client stub records every table / insert / update /
// change-log call, and we assert the ingester takes the correct
// path for each review-gate state (new / manual / rejected /
// approved / pending_review).

import { ingestScryfallMTG } from '../ingest'

type FakeRow = {
  id?: string
  tcg: string
  set_code: string
  language: string
  verification_mode?: 'manual' | 'automated'
  review_status?: 'pending_review' | 'approved' | 'rejected'
  release_date?: string | null
  release_date_precision?: 'day' | 'month' | 'tbc'
  confirmation_status?: string
  source_url?: string | null
  proposed_release_date?: string | null
  [key: string]: unknown
}

type Op =
  | { kind: 'select'; tcg: string; set_code: string; language: string }
  | { kind: 'insert'; table: string; row: Record<string, unknown> }
  | { kind: 'update'; table: string; patch: Record<string, unknown>; id: string }
  | { kind: 'change_log'; row: Record<string, unknown> }

function makeSb(initial: FakeRow[] = []) {
  const ops: Op[] = []
  const rows = [...initial]
  const sb = {
    from(table: string) {
      return {
        select(_fields: string) {
          const chain = {
            _eq: {} as Record<string, unknown>,
            eq(col: string, val: unknown) {
              chain._eq[col] = val
              return chain
            },
            maybeSingle() {
              if (table === 'network_tcg_releases') {
                ops.push({
                  kind: 'select',
                  tcg: chain._eq.tcg as string,
                  set_code: chain._eq.set_code as string,
                  language: chain._eq.language as string,
                })
                const match = rows.find((r) =>
                  r.tcg === chain._eq.tcg &&
                  r.set_code === chain._eq.set_code &&
                  r.language === chain._eq.language,
                )
                return Promise.resolve({ data: match ?? null, error: null })
              }
              return Promise.resolve({ data: null, error: null })
            },
          }
          return chain
        },
        insert(row: Record<string, unknown>) {
          if (table === 'network_tcg_releases') {
            ops.push({ kind: 'insert', table, row })
            rows.push({ id: `fake-${rows.length + 1}`, ...(row as FakeRow) })
          } else if (table === 'network_tcg_release_changes') {
            ops.push({ kind: 'change_log', row })
          }
          return Promise.resolve({ error: null })
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              if (col !== 'id') throw new Error('test stub only supports update by id')
              if (table === 'network_tcg_releases') {
                ops.push({ kind: 'update', table, patch, id: val as string })
                const r = rows.find((x) => x.id === val)
                if (r) Object.assign(r, patch)
              }
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }
  return { sb: sb as unknown as Parameters<typeof ingestScryfallMTG>[0], ops, rows }
}

function stubScryfall(sets: Array<{ code: string; name: string; released_at: string | null; set_type: string }>) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    if (typeof url === 'string' && url.includes('api.scryfall.com/sets')) {
      return new Response(JSON.stringify({ object: 'list', data: sets }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  }) as typeof globalThis.fetch
  return () => { globalThis.fetch = originalFetch }
}

const future = '2027-03-19'

describe('ingester state machine — review gate paths', () => {
  it('NEW ROW → INSERT with review_status=pending_review', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek', released_at: future, set_type: 'expansion' },
    ])
    try {
      const { sb, ops } = makeSb([])
      const r = await ingestScryfallMTG(sb)
      expect(r.ok).toBe(true)
      expect(r.inserted).toBe(1)
      expect(r.date_changes).toBe(0)
      expect(r.date_proposals).toBe(0)
      const ins = ops.find((o) => o.kind === 'insert' && o.table === 'network_tcg_releases') as { kind: 'insert'; row: Record<string, unknown> } | undefined
      expect(ins, 'insert op expected').toBeTruthy()
      expect(ins!.row['review_status']).toBe('pending_review')
      expect(ins!.row['verification_mode']).toBe('automated')
    } finally { restore() }
  })

  it('MANUAL ROW → preserved; only source_verified_at refreshed', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek', released_at: future, set_type: 'expansion' },
    ])
    try {
      const { sb, ops } = makeSb([{
        id: 'row-manual',
        tcg: 'mtg', set_code: 'TRK', language: 'en',
        verification_mode: 'manual',
        review_status: 'approved',
        release_date: '2026-12-01',
        confirmation_status: 'confirmed',
      }])
      await ingestScryfallMTG(sb)
      const updates = ops.filter((o) => o.kind === 'update') as Array<{ kind: 'update'; patch: Record<string, unknown> }>
      expect(updates.length).toBe(1)
      expect(Object.keys(updates[0]!.patch).sort()).toEqual(['source_verified_at'])
      expect(ops.filter((o) => o.kind === 'change_log')).toHaveLength(0)
    } finally { restore() }
  })

  it('REJECTED ROW → preserved; no re-pending; no clobber', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek', released_at: future, set_type: 'expansion' },
    ])
    try {
      const { sb, ops } = makeSb([{
        id: 'row-rej',
        tcg: 'mtg', set_code: 'TRK', language: 'en',
        verification_mode: 'automated',
        review_status: 'rejected',
        release_date: '2026-12-01',
      }])
      await ingestScryfallMTG(sb)
      const updates = ops.filter((o) => o.kind === 'update') as Array<{ kind: 'update'; patch: Record<string, unknown> }>
      expect(updates.length).toBe(1)
      expect(Object.keys(updates[0]!.patch).sort()).toEqual(['source_verified_at'])
      expect(updates[0]!.patch['review_status']).toBeUndefined()
      expect(updates[0]!.patch['release_date']).toBeUndefined()
    } finally { restore() }
  })

  it('APPROVED ROW + DATE SHIFT → writes proposed_release_date, NOT release_date; logs date_proposed', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek', released_at: future, set_type: 'expansion' },
    ])
    try {
      const approvedDate = '2027-02-05'
      const { sb, ops } = makeSb([{
        id: 'row-approved',
        tcg: 'mtg', set_code: 'TRK', language: 'en',
        verification_mode: 'automated',
        review_status: 'approved',
        release_date: approvedDate,
        release_date_precision: 'day',
      }])
      const r = await ingestScryfallMTG(sb)
      expect(r.date_proposals).toBe(1)
      expect(r.date_changes).toBe(0)
      const update = ops.find((o) => o.kind === 'update' && o.id === 'row-approved') as { kind: 'update'; patch: Record<string, unknown> } | undefined
      expect(update, 'update op expected').toBeTruthy()
      expect(update!.patch['release_date']).toBeUndefined()
      expect(update!.patch['proposed_release_date']).toBe(future)
      expect(update!.patch['proposed_release_date_precision']).toBe('day')
      expect(update!.patch['proposed_change_source']).toBe('ingestion:scryfall')
      const log = ops.find((o) => o.kind === 'change_log') as { kind: 'change_log'; row: Record<string, unknown> } | undefined
      expect(log, 'change-log row expected').toBeTruthy()
      expect(log!.row['change_type']).toBe('date_proposed')
      expect(log!.row['change_source']).toBe('ingestion')
    } finally { restore() }
  })

  it('APPROVED ROW + SAME DATE → refreshes non-date fields; NO proposal; NO change-log', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek (New Name)', released_at: future, set_type: 'expansion' },
    ])
    try {
      const { sb, ops } = makeSb([{
        id: 'row-same',
        tcg: 'mtg', set_code: 'TRK', language: 'en',
        verification_mode: 'automated',
        review_status: 'approved',
        release_date: future,
        release_date_precision: 'day',
      }])
      const r = await ingestScryfallMTG(sb)
      expect(r.date_proposals).toBe(0)
      expect(r.date_changes).toBe(0)
      const update = ops.find((o) => o.kind === 'update') as { kind: 'update'; patch: Record<string, unknown> } | undefined
      expect(update).toBeTruthy()
      expect(update!.patch['proposed_release_date']).toBeUndefined()
      expect(update!.patch['set_name']).toBe('Star Trek (New Name)')
      expect(ops.filter((o) => o.kind === 'change_log')).toHaveLength(0)
    } finally { restore() }
  })

  it('PENDING_REVIEW ROW + DATE SHIFT → updates release_date directly; logs date_changed', async () => {
    const restore = stubScryfall([
      { code: 'TRK', name: 'Star Trek', released_at: future, set_type: 'expansion' },
    ])
    try {
      const prevDate = '2027-02-05'
      const { sb, ops } = makeSb([{
        id: 'row-pending',
        tcg: 'mtg', set_code: 'TRK', language: 'en',
        verification_mode: 'automated',
        review_status: 'pending_review',
        release_date: prevDate,
      }])
      const r = await ingestScryfallMTG(sb)
      expect(r.date_changes).toBe(1)
      expect(r.date_proposals).toBe(0)
      const update = ops.find((o) => o.kind === 'update') as { kind: 'update'; patch: Record<string, unknown> } | undefined
      expect(update!.patch['release_date']).toBe(future)
      expect(update!.patch['proposed_release_date']).toBeUndefined()
      const log = ops.find((o) => o.kind === 'change_log') as { kind: 'change_log'; row: Record<string, unknown> } | undefined
      expect(log!.row['change_type']).toBe('date_changed')
    } finally { restore() }
  })
})
