import 'server-only';

// CN-STOCK-02 · probe worker.
//
// Per cron fire:
//   1. SELECT up to N enabled watchlist rows where next_check_at <= now().
//   2. For each: robots gate → fetch → classify → decide → atomically
//      insert observation + update watchlist + maybe insert event.
//   3. Advance next_check_at.
//   4. For every new event, enqueue an outbox row (idempotent on
//      cn_stock_outbox.idempotency_key).
//
// Safe under concurrent runs: event creation uses a UNIQUE
// transition_key constraint; outbox enqueue uses a UNIQUE
// idempotency_key constraint. If two workers process the same
// watchlist row at the same time, the second one's INSERT fails
// cleanly and we skip to the next row.

import type { SupabaseClient } from '@supabase/supabase-js';
import { classify } from './extract';
import { fetchWithLimits, HostGate } from './fetch';
import { robotsAllows } from './robots';
import { decide } from './stateMachine';
import { buildPayload } from './discord';
import type {
  EventRow,
  ObservationInput,
  ObservationState,
  WatchlistRow,
} from './types';

export interface ProbeOutcome {
  watchlist_id: string;
  url: string;
  observation_state: ObservationState;
  emitted_event: boolean;
  outbox_enqueued: boolean;
  duration_ms: number;
  error: string | null;
}

export interface ProbeSummary {
  fired_at: string;
  listings_examined: number;
  listings_skipped_until_due: number;
  outcomes: ProbeOutcome[];
  events_emitted: number;
  outbox_enqueued: number;
  errors: string[];
  duration_ms: number;
}

const DEFAULT_LISTING_CAP = 50;
const DEFAULT_PER_HOST_DELAY_MS = 3_000;
const DEFAULT_TARGET = 'discord:test';

export async function runProbe(
  sb: SupabaseClient,
  options: {
    listing_cap?: number;
    per_host_delay_ms?: number;
    target?: string;
    now?: Date;
  } = {},
): Promise<ProbeSummary> {
  const started = Date.now();
  const nowDate = options.now ?? new Date();
  const nowIso = nowDate.toISOString();
  const listingCap = options.listing_cap ?? DEFAULT_LISTING_CAP;
  const perHostDelay = options.per_host_delay_ms ?? DEFAULT_PER_HOST_DELAY_MS;
  const target = options.target ?? DEFAULT_TARGET;

  // 1. Grab due rows. We don't lock them — concurrency is handled
  // by the UNIQUE constraints on event + outbox keys.
  const { data: due, error: readErr } = await sb.from('cn_stock_watchlist')
    .select('*')
    .eq('monitoring_enabled', true)
    .lte('next_check_at', nowIso)
    .order('next_check_at', { ascending: true })
    .limit(listingCap);
  if (readErr) {
    return {
      fired_at: nowIso,
      listings_examined: 0,
      listings_skipped_until_due: 0,
      outcomes: [],
      events_emitted: 0,
      outbox_enqueued: 0,
      errors: [`watchlist_read: ${readErr.message}`],
      duration_ms: Date.now() - started,
    };
  }

  const rows = (due ?? []) as WatchlistRow[];
  const hostAllowlist = new Set(rows.map((r) => new URL(r.url).hostname.toLowerCase()));
  const gate = new HostGate(perHostDelay);

  const outcomes: ProbeOutcome[] = [];
  let eventsEmitted = 0;
  let outboxEnqueued = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const t0 = Date.now();
    const host = new URL(row.url).hostname.toLowerCase();
    let observation: ObservationInput;
    let rowError: string | null = null;

    try {
      await gate.wait(host);

      // Robots gate — fail-closed in production.
      const rGate = await robotsAllows(row.url, hostAllowlist);
      if (!rGate.allowed) {
        observation = baseObs(nowIso, 'blocked', {
          robots_gate_reason: rGate.reason,
          error_detail: rGate.source,
        });
      } else {
        const got = await fetchWithLimits(row.url, { hostAllowlist, timeoutMs: 10_000, maxBytes: 2_000_000 });
        if (!got.ok) {
          const classified: ObservationState = got.status === 403 || got.status === 429 ? 'blocked' : 'unknown';
          observation = baseObs(nowIso, classified, {
            http_status: got.status,
            duration_ms: got.duration_ms,
            error_detail: got.error ?? `HTTP ${got.status}`,
          });
        } else {
          const cls = classify(got.body, row.product_name);
          observation = {
            state: cls.result as ObservationState,
            observed_at: nowIso,
            http_status: got.status,
            duration_ms: got.duration_ms,
            bytes_downloaded: got.bytes,
            extraction_method: cls.extraction_method,
            evidence_summary: cls.evidence_summary,
            identity_match: cls.identity_match,
            price: cls.price,
            currency: cls.currency,
            error_detail: null,
            robots_gate_reason: null,
          };
        }
      }
    } catch (e) {
      rowError = (e as Error)?.message ?? String(e);
      observation = baseObs(nowIso, 'unknown', { error_detail: rowError });
    }

    // Apply state machine.
    const decision = decide(row, observation);

    // Write observation.
    const { error: obsErr } = await sb.from('cn_stock_observations').insert({
      watchlist_id: row.id,
      observed_at: observation.observed_at,
      observation_state: observation.state,
      http_status: observation.http_status,
      duration_ms: observation.duration_ms,
      bytes_downloaded: observation.bytes_downloaded,
      extraction_method: observation.extraction_method,
      evidence_summary: observation.evidence_summary,
      identity_match: observation.identity_match,
      price: observation.price,
      currency: observation.currency,
      error_detail: observation.error_detail,
      robots_gate_reason: observation.robots_gate_reason,
    });
    if (obsErr) errors.push(`${row.id} observation_insert: ${obsErr.message}`);

    // Patch watchlist (advance next_check_at too).
    const next_check_at = new Date(nowDate.getTime() + row.check_interval_minutes * 60_000).toISOString();
    const { error: updErr } = await sb.from('cn_stock_watchlist').update({
      ...decision.watchlist_patch,
      next_check_at,
    }).eq('id', row.id);
    if (updErr) errors.push(`${row.id} watchlist_update: ${updErr.message}`);

    // Emit event + enqueue outbox if the decision calls for it.
    let emittedEvent = false;
    let enqueuedOutbox = false;
    if (decision.emit_event) {
      const eventInsert = {
        watchlist_id: row.id,
        transition_key: decision.emit_event.transition_key,
        detected_at: nowIso,
        previous_state: decision.emit_event.previous_state,
        new_state: decision.emit_event.new_state,
        evidence_summary: decision.emit_event.evidence_summary,
        price: decision.emit_event.price,
        currency: decision.emit_event.currency,
        notification_eligible: true,
      };
      const { data: insertedEvent, error: eventErr } = await sb.from('cn_stock_events')
        .insert(eventInsert)
        .select('*')
        .single();
      if (eventErr) {
        if (/duplicate key/i.test(eventErr.message) || eventErr.code === '23505') {
          // Another worker already created this event for this
          // minute bucket — benign; skip outbox enqueue.
        } else {
          errors.push(`${row.id} event_insert: ${eventErr.message}`);
        }
      } else if (insertedEvent) {
        emittedEvent = true;
        eventsEmitted += 1;
        // Enqueue outbox. idempotency_key = event.id uniqueness
        // prevents double-enqueue if we retry this probe on crash.
        const event = insertedEvent as EventRow;
        const payload = buildPayload(event, row);
        const { error: outErr } = await sb.from('cn_stock_outbox').insert({
          event_id: event.id,
          target,
          idempotency_key: event.id,
          payload: payload as unknown as Record<string, unknown>,
          status: 'pending',
          next_attempt_at: nowIso,
        });
        if (outErr) {
          if (/duplicate key/i.test(outErr.message) || outErr.code === '23505') {
            // Already enqueued — fine.
          } else {
            errors.push(`${row.id} outbox_insert: ${outErr.message}`);
          }
        } else {
          enqueuedOutbox = true;
          outboxEnqueued += 1;
        }
      }
    }

    outcomes.push({
      watchlist_id: row.id,
      url: row.url,
      observation_state: observation.state,
      emitted_event: emittedEvent,
      outbox_enqueued: enqueuedOutbox,
      duration_ms: Date.now() - t0,
      error: rowError,
    });
  }

  return {
    fired_at: nowIso,
    listings_examined: rows.length,
    listings_skipped_until_due: 0,  // we only read due rows
    outcomes,
    events_emitted: eventsEmitted,
    outbox_enqueued: outboxEnqueued,
    errors,
    duration_ms: Date.now() - started,
  };
}

function baseObs(nowIso: string, state: ObservationState, extra: Partial<ObservationInput> = {}): ObservationInput {
  return {
    state,
    observed_at: nowIso,
    http_status: extra.http_status ?? null,
    duration_ms: extra.duration_ms ?? null,
    bytes_downloaded: extra.bytes_downloaded ?? null,
    extraction_method: extra.extraction_method ?? null,
    evidence_summary: extra.evidence_summary ?? null,
    identity_match: extra.identity_match ?? null,
    price: extra.price ?? null,
    currency: extra.currency ?? null,
    error_detail: extra.error_detail ?? null,
    robots_gate_reason: extra.robots_gate_reason ?? null,
  };
}
