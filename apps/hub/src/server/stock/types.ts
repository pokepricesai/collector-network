import 'server-only';

// CN-STOCK-02 · shared types.
//
// Mirrors supabase/migrations/20261107050000_cn_stock_02_engine.sql
// 1:1. The migration is the authoritative schema; this file is the
// TypeScript projection used by the probe, delivery worker, state
// machine, and admin pages.

export type ObservationState =
  | 'in_stock'
  | 'out_of_stock'
  | 'preorder'
  | 'unknown'
  | 'blocked';

export type ConfirmedState = 'in_stock' | 'out_of_stock' | 'preorder';

export type Country = 'UK' | 'US' | 'EU' | 'CA' | 'AU' | 'JP' | 'OTHER';
export type Game = 'pokemon' | 'mtg' | 'ygo' | 'onepiece' | 'lorcana' | 'other';

export type ExtractionMethod = 'json_ld' | 'meta' | 'microdata' | 'none';

export type OutboxStatus =
  | 'pending'
  | 'sending'
  | 'delivered'
  | 'failed_retryable'
  | 'failed_permanent'
  | 'timeout_ambiguous';

export interface WatchlistRow {
  id: string;
  retailer: string;
  country: Country;
  game: Game;
  product_name: string;
  variant: string | null;
  url: string;
  monitoring_enabled: boolean;
  check_interval_minutes: number;
  last_confirmed_state: ConfirmedState | null;
  last_observation_state: ObservationState | null;
  last_price: number | null;
  last_currency: string | null;
  last_observed_at: string | null;
  last_state_changed_at: string | null;
  last_check_attempted_at: string | null;
  next_check_at: string;
  consecutive_in_stock_count: number;
  consecutive_out_of_stock_count: number;
  consecutive_unknown_count: number;
  consecutive_blocked_count: number;
  consecutive_fail_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ObservationRow {
  id: string;
  watchlist_id: string;
  observed_at: string;
  observation_state: ObservationState;
  http_status: number | null;
  duration_ms: number | null;
  bytes_downloaded: number | null;
  extraction_method: ExtractionMethod | null;
  evidence_summary: string | null;
  identity_match: boolean | null;
  price: number | null;
  currency: string | null;
  error_detail: string | null;
  robots_gate_reason: string | null;
}

export interface EventRow {
  id: string;
  watchlist_id: string;
  transition_key: string;
  detected_at: string;
  previous_state: ConfirmedState;
  new_state: ConfirmedState;
  evidence_summary: string | null;
  price: number | null;
  currency: string | null;
  notification_eligible: boolean;
  created_at: string;
}

export interface OutboxRow {
  id: string;
  event_id: string;
  target: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempted_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** What the probe produces for one listing; the state machine
 *  consumes this to decide how to update the watchlist and
 *  whether to emit an event. */
export interface ObservationInput {
  state: ObservationState;
  observed_at: string;
  http_status: number | null;
  duration_ms: number | null;
  bytes_downloaded: number | null;
  extraction_method: ExtractionMethod | null;
  evidence_summary: string | null;
  identity_match: boolean | null;
  price: number | null;
  currency: string | null;
  error_detail: string | null;
  robots_gate_reason: string | null;
}

/** The state machine's output. The caller applies the update to
 *  the watchlist row and inserts the event row (if any) inside a
 *  single DB transaction. */
export interface TransitionDecision {
  watchlist_patch: Partial<WatchlistRow>;
  emit_event: {
    transition_key: string;
    previous_state: ConfirmedState;
    new_state: ConfirmedState;
    evidence_summary: string | null;
    price: number | null;
    currency: string | null;
  } | null;
  rationale: string;
}
