import 'server-only';

// CN-STOCK-02 · deterministic state machine.
//
// Pure function. Given the current watchlist row + a new
// observation, decide:
//   1. How to patch the watchlist row.
//   2. Whether to emit a cn_stock_events row (and with what key).
//
// Implements the 10 rules from the brief. The caller (probe.ts)
// applies the decision atomically. This file contains NO I/O
// and NO randomness; every input→output mapping is covered by
// vitest cases in __tests__/stateMachine.test.ts.

import type {
  ConfirmedState,
  ObservationInput,
  ObservationState,
  TransitionDecision,
  WatchlistRow,
} from './types';

/** How many consecutive in_stock observations are required before
 *  we accept a confirmed out_of_stock → in_stock transition as
 *  restock? Rule 3: "Require repeated confirming observations for
 *  changes that would otherwise trigger notifications." A value
 *  of 2 means: one observation flips the signal, the next one
 *  confirms it and emits the event. */
export const CONFIRMING_CONSECUTIVE_IN_STOCK = 2;

/** Mirror value for out_of_stock confirmation — we DON'T notify
 *  on the in→out transition (there's no customer value in that),
 *  but we still require confirmation before flipping the stored
 *  state, so a transient 404-via-sold-out-widget doesn't trip
 *  the next in_stock back to a restock event. */
export const CONFIRMING_CONSECUTIVE_OUT_OF_STOCK = 2;

/** Build a deterministic transition_key. Includes the watchlist
 *  id + direction + minute bucket so two concurrent workers
 *  processing the same observation batch create the same key
 *  and the UNIQUE constraint rejects the duplicate. The minute
 *  bucket is 15-minute aligned to tolerate clock skew. */
export function buildTransitionKey(args: {
  watchlist_id: string;
  previous_state: ConfirmedState;
  new_state: ConfirmedState;
  detected_at: Date;
}): string {
  const bucketMs = 15 * 60 * 1000;
  const bucket = Math.floor(args.detected_at.getTime() / bucketMs) * bucketMs;
  const bucketIso = new Date(bucket).toISOString().slice(0, 16) + 'Z';
  return `${args.watchlist_id}:${args.previous_state}->${args.new_state}:${bucketIso}`;
}

export function decide(
  row: Pick<WatchlistRow, 'id' | 'last_confirmed_state' | 'consecutive_in_stock_count'
    | 'consecutive_out_of_stock_count' | 'consecutive_unknown_count'
    | 'consecutive_blocked_count' | 'consecutive_fail_count'>,
  obs: ObservationInput,
): TransitionDecision {
  const state: ObservationState = obs.state;
  const prev = row.last_confirmed_state;
  const now = obs.observed_at;

  // Common: every observation updates these audit fields regardless.
  const basePatch = {
    last_observation_state: state,
    last_observed_at: now,
    last_check_attempted_at: now,
  };

  // ── Rule 4 + 5: unknown / blocked never establish a new state.
  //    They preserve the previous confirmed state and increment
  //    the appropriate counter. The probe caller surfaces staleness
  //    via consecutive_unknown_count on the admin UI.
  if (state === 'unknown') {
    return {
      watchlist_patch: {
        ...basePatch,
        consecutive_unknown_count: row.consecutive_unknown_count + 1,
        // Reset all state-affecting counters so a run of 'unknown's
        // then a single 'in_stock' doesn't clear a half-earned
        // transition — we re-require full confirmation.
        consecutive_in_stock_count: 0,
        consecutive_out_of_stock_count: 0,
        consecutive_blocked_count: 0,
      },
      emit_event: null,
      rationale: `unknown observation; preserving last_confirmed_state=${prev ?? 'null'}`,
    };
  }
  if (state === 'blocked') {
    return {
      watchlist_patch: {
        ...basePatch,
        consecutive_blocked_count: row.consecutive_blocked_count + 1,
        consecutive_fail_count: row.consecutive_fail_count + 1,
        consecutive_in_stock_count: 0,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 0,
      },
      emit_event: null,
      rationale: `blocked observation (${obs.robots_gate_reason ?? obs.error_detail ?? 'unknown reason'}); preserving last_confirmed_state=${prev ?? 'null'}`,
    };
  }

  // From here on, state ∈ { in_stock, out_of_stock, preorder }.
  // Rule 1: first observation = baseline, never alert.
  if (prev == null) {
    return {
      watchlist_patch: {
        ...basePatch,
        last_confirmed_state: state,
        last_state_changed_at: now,
        last_price: obs.price,
        last_currency: obs.currency,
        consecutive_in_stock_count: state === 'in_stock' ? 1 : 0,
        consecutive_out_of_stock_count: state === 'out_of_stock' ? 1 : 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: null,
      rationale: `baseline established as ${state}; no event emitted`,
    };
  }

  // Same confirmed state (or re-observation of the current one).
  if (state === prev) {
    return {
      watchlist_patch: {
        ...basePatch,
        last_price: obs.price ?? null,
        last_currency: obs.currency ?? null,
        consecutive_in_stock_count: state === 'in_stock' ? row.consecutive_in_stock_count + 1 : 0,
        consecutive_out_of_stock_count: state === 'out_of_stock' ? row.consecutive_out_of_stock_count + 1 : 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: null,
      rationale: `re-observed ${state}; no transition`,
    };
  }

  // Confirmed-state TRANSITION candidate.
  // Rule 3: require repeated confirming observations before
  // committing. For out→in we need CONFIRMING_CONSECUTIVE_IN_STOCK
  // observations in a row; for in→out we need CONFIRMING_CONSECUTIVE_OUT_OF_STOCK.

  if (state === 'in_stock' && prev === 'out_of_stock') {
    const nextCount = row.consecutive_in_stock_count + 1;
    if (nextCount < CONFIRMING_CONSECUTIVE_IN_STOCK) {
      return {
        watchlist_patch: {
          ...basePatch,
          consecutive_in_stock_count: nextCount,
          consecutive_out_of_stock_count: 0,
          consecutive_unknown_count: 0,
          consecutive_blocked_count: 0,
        },
        emit_event: null,
        rationale: `tentative in_stock after out_of_stock; need ${CONFIRMING_CONSECUTIVE_IN_STOCK - nextCount} more confirming observation(s) before emitting`,
      };
    }
    // Confirmed restock.
    const key = buildTransitionKey({
      watchlist_id: row.id,
      previous_state: 'out_of_stock',
      new_state: 'in_stock',
      detected_at: new Date(now),
    });
    return {
      watchlist_patch: {
        ...basePatch,
        last_confirmed_state: 'in_stock',
        last_state_changed_at: now,
        last_price: obs.price,
        last_currency: obs.currency,
        consecutive_in_stock_count: nextCount,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: {
        transition_key: key,
        previous_state: 'out_of_stock',
        new_state: 'in_stock',
        evidence_summary: obs.evidence_summary,
        price: obs.price,
        currency: obs.currency,
      },
      rationale: `confirmed out_of_stock → in_stock after ${nextCount} consecutive in_stock observations; event emitted`,
    };
  }

  if (state === 'out_of_stock' && prev === 'in_stock') {
    const nextCount = row.consecutive_out_of_stock_count + 1;
    if (nextCount < CONFIRMING_CONSECUTIVE_OUT_OF_STOCK) {
      return {
        watchlist_patch: {
          ...basePatch,
          consecutive_out_of_stock_count: nextCount,
          consecutive_in_stock_count: 0,
          consecutive_unknown_count: 0,
          consecutive_blocked_count: 0,
        },
        emit_event: null,
        rationale: `tentative out_of_stock after in_stock; need ${CONFIRMING_CONSECUTIVE_OUT_OF_STOCK - nextCount} more confirming observation(s) to flip stored state`,
      };
    }
    // Confirmed out-of-stock. We DON'T emit an event (not notifiable),
    // but we DO update the stored state so the next in_stock will
    // require the full re-confirmation cycle to become a restock.
    return {
      watchlist_patch: {
        ...basePatch,
        last_confirmed_state: 'out_of_stock',
        last_state_changed_at: now,
        // Drop price on going out of stock — the price we last saw
        // isn't the restock price. Operator sees NULL and knows.
        last_price: null,
        last_currency: null,
        consecutive_out_of_stock_count: nextCount,
        consecutive_in_stock_count: 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: null,
      rationale: `confirmed in_stock → out_of_stock after ${nextCount} consecutive out_of_stock observations; stored state flipped, no notification`,
    };
  }

  // Preorder as its own confirmed state. Rule 6: never a "restock".
  if (state === 'preorder') {
    // Preorder is a self-contained state; we track it but never
    // alert on it in v1 (it's always pre-announced, not spike-
    // interest). Transitions INTO preorder just update state.
    return {
      watchlist_patch: {
        ...basePatch,
        last_confirmed_state: 'preorder',
        last_state_changed_at: prev === 'preorder' ? undefined : now,
        last_price: obs.price,
        last_currency: obs.currency,
        consecutive_in_stock_count: 0,
        consecutive_out_of_stock_count: 0,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: null,
      rationale: `preorder observed; no restock notification`,
    };
  }

  // in_stock after preorder, or out_of_stock after preorder:
  // treat as a state flip (not a restock in the alerting sense —
  // preorder is pre-launch; transitioning to in_stock is the
  // product launching, which we may wish to alert on in future
  // work but is NOT the restock pipeline this milestone proves).
  // Confirm first, no event.
  if (prev === 'preorder') {
    const nextInStockCount = state === 'in_stock' ? row.consecutive_in_stock_count + 1 : 0;
    const nextOutCount = state === 'out_of_stock' ? row.consecutive_out_of_stock_count + 1 : 0;
    const requireIn = CONFIRMING_CONSECUTIVE_IN_STOCK;
    const requireOut = CONFIRMING_CONSECUTIVE_OUT_OF_STOCK;
    const ready = (state === 'in_stock' && nextInStockCount >= requireIn)
      || (state === 'out_of_stock' && nextOutCount >= requireOut);
    if (!ready) {
      return {
        watchlist_patch: {
          ...basePatch,
          consecutive_in_stock_count: nextInStockCount,
          consecutive_out_of_stock_count: nextOutCount,
          consecutive_unknown_count: 0,
          consecutive_blocked_count: 0,
        },
        emit_event: null,
        rationale: `tentative preorder → ${state}; need more confirming observations`,
      };
    }
    return {
      watchlist_patch: {
        ...basePatch,
        last_confirmed_state: state,
        last_state_changed_at: now,
        last_price: state === 'in_stock' ? obs.price : null,
        last_currency: state === 'in_stock' ? obs.currency : null,
        consecutive_in_stock_count: nextInStockCount,
        consecutive_out_of_stock_count: nextOutCount,
        consecutive_unknown_count: 0,
        consecutive_blocked_count: 0,
        consecutive_fail_count: 0,
      },
      emit_event: null,  // NOT an out_of_stock → in_stock restock
      rationale: `preorder → ${state} after confirmation; stored state flipped, no restock notification`,
    };
  }

  // Theoretically unreachable; keep for completeness.
  return {
    watchlist_patch: basePatch,
    emit_event: null,
    rationale: `unexpected transition ${prev} → ${state}; no event`,
  };
}
