import { describe, it, expect } from 'vitest'
import { decide, buildTransitionKey, CONFIRMING_CONSECUTIVE_IN_STOCK } from '../stateMachine'
import type { ObservationInput, WatchlistRow } from '../types'

// CN-STOCK-02 · state machine test matrix.
//
// Each test exercises one of the 10 rules from the brief. The
// matcher is `decide()` — a pure function with no side effects.

function makeRow(partial: Partial<WatchlistRow> = {}): Pick<WatchlistRow,
  'id' | 'last_confirmed_state' | 'consecutive_in_stock_count'
  | 'consecutive_out_of_stock_count' | 'consecutive_unknown_count'
  | 'consecutive_blocked_count' | 'consecutive_fail_count'> {
  return {
    id: partial.id ?? 'w-1',
    last_confirmed_state: partial.last_confirmed_state ?? null,
    consecutive_in_stock_count: partial.consecutive_in_stock_count ?? 0,
    consecutive_out_of_stock_count: partial.consecutive_out_of_stock_count ?? 0,
    consecutive_unknown_count: partial.consecutive_unknown_count ?? 0,
    consecutive_blocked_count: partial.consecutive_blocked_count ?? 0,
    consecutive_fail_count: partial.consecutive_fail_count ?? 0,
  }
}

function makeObs(state: ObservationInput['state'], overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    state,
    observed_at: overrides.observed_at ?? '2026-11-07T10:00:00Z',
    http_status: overrides.http_status ?? 200,
    duration_ms: overrides.duration_ms ?? 400,
    bytes_downloaded: overrides.bytes_downloaded ?? 50_000,
    extraction_method: overrides.extraction_method ?? 'json_ld',
    evidence_summary: overrides.evidence_summary ?? 'Offer.availability=https://schema.org/InStock',
    identity_match: overrides.identity_match ?? true,
    price: overrides.price ?? 219.97,
    currency: overrides.currency ?? 'USD',
    error_detail: overrides.error_detail ?? null,
    robots_gate_reason: overrides.robots_gate_reason ?? null,
  }
}

describe('Rule 1 — first observation is baseline, never alerts', () => {
  it('first in_stock establishes baseline, emits NO event', () => {
    const r = decide(makeRow({ last_confirmed_state: null }), makeObs('in_stock'))
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.last_confirmed_state).toBe('in_stock')
    expect(r.watchlist_patch.consecutive_in_stock_count).toBe(1)
  })

  it('first out_of_stock establishes baseline', () => {
    const r = decide(makeRow({ last_confirmed_state: null }), makeObs('out_of_stock', { evidence_summary: 'Offer.availability=OutOfStock' }))
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.last_confirmed_state).toBe('out_of_stock')
  })

  it('first preorder establishes baseline', () => {
    const r = decide(makeRow({ last_confirmed_state: null }), makeObs('preorder'))
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.last_confirmed_state).toBe('preorder')
  })
})

describe('Rule 2+3 — restock requires confirmed out→in with repeat', () => {
  it('first in_stock after out_of_stock does NOT emit (needs confirmation)', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'out_of_stock', consecutive_in_stock_count: 0 }),
      makeObs('in_stock'),
    )
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.consecutive_in_stock_count).toBe(1)
    // Crucially: stored state stays out_of_stock until confirmation.
    expect(r.watchlist_patch.last_confirmed_state).toBeUndefined()
  })

  it('second consecutive in_stock after out_of_stock emits exactly one event', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'out_of_stock', consecutive_in_stock_count: 1 }),
      makeObs('in_stock'),
    )
    expect(r.emit_event).not.toBeNull()
    expect(r.emit_event!.previous_state).toBe('out_of_stock')
    expect(r.emit_event!.new_state).toBe('in_stock')
    expect(r.emit_event!.transition_key).toMatch(/^w-1:out_of_stock->in_stock:/)
    expect(r.watchlist_patch.last_confirmed_state).toBe('in_stock')
  })
})

describe('Rule 7 — repeated in_stock does not generate duplicate events', () => {
  it('same-state re-observation never emits', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'in_stock', consecutive_in_stock_count: 5 }),
      makeObs('in_stock'),
    )
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.consecutive_in_stock_count).toBe(6)
  })
})

describe('Rule 4 — unknown/blocked never trigger events', () => {
  it('unknown does not emit', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'out_of_stock' }),
      makeObs('unknown', { extraction_method: 'none', evidence_summary: 'no availability signal' }),
    )
    expect(r.emit_event).toBeNull()
  })

  it('blocked does not emit', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'out_of_stock' }),
      makeObs('blocked', { robots_gate_reason: 'robots.txt Disallow: /products/' }),
    )
    expect(r.emit_event).toBeNull()
  })

  it('an unknown then an in_stock does NOT emit (confirmation reset)', () => {
    // After baseline out_of_stock, probe sees: in_stock (count=1), then unknown
    // (counter reset to 0), then in_stock again (count=1). That still shouldn't
    // emit without a second confirming in_stock.
    const afterUnknown = decide(
      makeRow({ last_confirmed_state: 'out_of_stock', consecutive_in_stock_count: 1 }),
      makeObs('unknown'),
    )
    expect(afterUnknown.watchlist_patch.consecutive_in_stock_count).toBe(0)

    const afterInStock = decide(
      {
        id: 'w-1',
        last_confirmed_state: 'out_of_stock',
        consecutive_in_stock_count: 0,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 1,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      makeObs('in_stock'),
    )
    expect(afterInStock.emit_event).toBeNull()
    expect(afterInStock.watchlist_patch.consecutive_in_stock_count).toBe(1)
  })
})

describe('Rule 5 — unknown preserves previous confirmed state', () => {
  it('unknown with existing in_stock state keeps in_stock', () => {
    const r = decide(
      makeRow({ last_confirmed_state: 'in_stock', consecutive_in_stock_count: 10 }),
      makeObs('unknown'),
    )
    expect(r.watchlist_patch.last_confirmed_state).toBeUndefined()
    expect(r.watchlist_patch.consecutive_unknown_count).toBe(1)
    expect(r.rationale).toMatch(/preserving last_confirmed_state=in_stock/)
  })
})

describe('Rule 6 — preorder is a distinct state, never a restock', () => {
  it('preorder observation sets state but emits nothing', () => {
    const r = decide(makeRow({ last_confirmed_state: null }), makeObs('preorder'))
    expect(r.emit_event).toBeNull()
    expect(r.watchlist_patch.last_confirmed_state).toBe('preorder')
  })

  it('preorder → in_stock transition does NOT emit an event (product launching, not restock)', () => {
    // First in_stock after preorder
    const first = decide(
      makeRow({ last_confirmed_state: 'preorder', consecutive_in_stock_count: 0 }),
      makeObs('in_stock'),
    )
    expect(first.emit_event).toBeNull()
    // Second confirming in_stock also does NOT emit (brief: not a restock)
    const second = decide(
      {
        id: 'w-1',
        last_confirmed_state: 'preorder',
        consecutive_in_stock_count: 1,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      makeObs('in_stock'),
    )
    expect(second.emit_event).toBeNull()
    expect(second.watchlist_patch.last_confirmed_state).toBe('in_stock')
    expect(second.rationale).toMatch(/preorder → in_stock/)
  })
})

describe('Rule 8 — source failures do not trigger false restocks when access returns', () => {
  it('long run of blocked then a single in_stock does NOT emit (confirmation reset)', () => {
    // Started out_of_stock, hit a Cloudflare 403 streak, then one 200 in_stock.
    const afterBlocked = decide(
      makeRow({ last_confirmed_state: 'out_of_stock', consecutive_blocked_count: 10 }),
      makeObs('blocked'),
    )
    expect(afterBlocked.watchlist_patch.consecutive_blocked_count).toBe(11)

    const afterOne = decide(
      {
        id: 'w-1',
        last_confirmed_state: 'out_of_stock',
        consecutive_in_stock_count: 0,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 11,
        consecutive_fail_count: 11,
      },
      makeObs('in_stock'),
    )
    expect(afterOne.emit_event).toBeNull()
    expect(afterOne.watchlist_patch.consecutive_in_stock_count).toBe(1)
  })
})

describe('transition_key — deterministic + collision-safe', () => {
  it('same watchlist + transition + minute bucket → same key', () => {
    const a = buildTransitionKey({
      watchlist_id: 'w-1',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date('2026-11-07T10:14:59Z'),
    })
    const b = buildTransitionKey({
      watchlist_id: 'w-1',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date('2026-11-07T10:00:00Z'),
    })
    expect(a).toBe(b)
  })

  it('different minute buckets → different keys', () => {
    const a = buildTransitionKey({
      watchlist_id: 'w-1',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date('2026-11-07T10:00:00Z'),
    })
    const b = buildTransitionKey({
      watchlist_id: 'w-1',
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date('2026-11-07T10:15:00Z'),
    })
    expect(a).not.toBe(b)
  })
})

describe('full restock cycle (integration-shape, pure)', () => {
  it('baseline out → unknown → in → unknown → in produces exactly one event', () => {
    // 1. First observation: out_of_stock. Baseline.
    let state = makeRow({ last_confirmed_state: null })
    const r1 = decide(state, makeObs('out_of_stock'))
    expect(r1.emit_event).toBeNull()
    state = applyPatch(state, r1.watchlist_patch)
    expect(state.last_confirmed_state).toBe('out_of_stock')

    // 2. unknown → preserves state.
    const r2 = decide(state, makeObs('unknown'))
    expect(r2.emit_event).toBeNull()
    state = applyPatch(state, r2.watchlist_patch)
    expect(state.last_confirmed_state).toBe('out_of_stock')

    // 3. First in_stock → tentative, no event, counter=1.
    const r3 = decide(state, makeObs('in_stock'))
    expect(r3.emit_event).toBeNull()
    state = applyPatch(state, r3.watchlist_patch)
    expect(state.consecutive_in_stock_count).toBe(1)

    // 4. unknown resets the counter — in_stock streak invalidated.
    const r4 = decide(state, makeObs('unknown'))
    expect(r4.emit_event).toBeNull()
    state = applyPatch(state, r4.watchlist_patch)
    expect(state.consecutive_in_stock_count).toBe(0)

    // 5. in_stock again, counter=1, still no event.
    const r5 = decide(state, makeObs('in_stock'))
    expect(r5.emit_event).toBeNull()
    state = applyPatch(state, r5.watchlist_patch)

    // 6. Second consecutive in_stock → CONFIRMED restock, one event.
    const r6 = decide(state, makeObs('in_stock'))
    expect(r6.emit_event).not.toBeNull()
    expect(r6.emit_event!.previous_state).toBe('out_of_stock')
    expect(r6.emit_event!.new_state).toBe('in_stock')
    state = applyPatch(state, r6.watchlist_patch)
    expect(state.last_confirmed_state).toBe('in_stock')

    // 7. Third consecutive in_stock → no additional event.
    const r7 = decide(state, makeObs('in_stock'))
    expect(r7.emit_event).toBeNull()
  })
})

function applyPatch(state: ReturnType<typeof makeRow>, patch: ReturnType<typeof decide>['watchlist_patch']) {
  return {
    ...state,
    last_confirmed_state: (patch.last_confirmed_state ?? state.last_confirmed_state) as typeof state.last_confirmed_state,
    consecutive_in_stock_count: patch.consecutive_in_stock_count ?? state.consecutive_in_stock_count,
    consecutive_out_of_stock_count: patch.consecutive_out_of_stock_count ?? state.consecutive_out_of_stock_count,
    consecutive_unknown_count: patch.consecutive_unknown_count ?? state.consecutive_unknown_count,
    consecutive_blocked_count: patch.consecutive_blocked_count ?? state.consecutive_blocked_count,
    consecutive_fail_count: patch.consecutive_fail_count ?? state.consecutive_fail_count,
  }
}

describe('CONFIRMING_CONSECUTIVE_IN_STOCK constant exported', () => {
  it('equals 2 (documented default)', () => {
    expect(CONFIRMING_CONSECUTIVE_IN_STOCK).toBe(2)
  })
})
