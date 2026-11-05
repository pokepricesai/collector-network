import 'server-only';

// CN-06.05-P03 (post-review): PSA refresh scheduler.
//
// Capacity-aware model — replaces the earlier 30/60/120d band scheme
// (mathematically impossible for 49k cards at 90/day). Instead:
//
//   1. Compute a PRIORITY COHORT = top N verified cards by raw USD DESC.
//      N defaults to 1,000. Recomputed at the top of every cron fire.
//   2. Per-day budget B (≤ cn_psa_api_usage.planned_cap, hard-capped at
//      hard_cap). Default planned=90, hard=100.
//   3. Allocate:
//        • cohortSlots  = ceil(N / cohortRotationDays)            (≈ 34 for N=1k, 30d)
//        • firstTimeSlots = B - cohortSlots                       (≈ 56)
//      Cohort refreshes rotate oldest-last_refresh_success first.
//      First-time slots cover never-refreshed verified cards,
//      prioritising highest raw USD.
//   4. Pokemon-only initially. The 4 TCG games stay structurally
//      supported but their candidates are status='unmapped' and
//      cannot be selected by the queue.
//
// Each API attempt is counted against the daily cap via cn_psa_reserve_slots
// BEFORE the HTTP request is issued. Failed attempts still consume slots —
// this is deliberate: an "attempt" is the atomic resource guarded by the cap.

import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { fetchPsaSpecPopulation, type PsaSpecPopulationPayload } from './apiClient'

export const CONFIG = {
  /** Operator ceiling (hard cap) enforced by cn_psa_reserve_slots. */
  hardCap:              100,
  /** Planned cap per UTC day (default; the DB row is authoritative). */
  plannedCap:           90,
  /** Size of the priority cohort. Top-N highest-value verified cards. */
  priorityCohortSize:   1_000,
  /** Approximate rotation period (days) for the priority cohort. */
  cohortRotationDays:   30,
  /** How many specs to attempt in one fire. MUST equal plannedCap so
   *  the single daily cron actually matches the documented 90/day
   *  capacity (34 cohort + 56 first-time). The reserve RPC still
   *  clamps if earlier attempts in the same UTC day consumed slots;
   *  hard cap 100 is the absolute ceiling. */
  batchTarget:          90,
  /** Lock TTL (seconds). */
  lockTtlSeconds:       15 * 60,
  /** Per-request timeout. */
  fetchTimeoutMs:       15_000,
  /** Inter-request pacing. */
  perRequestDelayMs:    150,
  /** Only Pokemon is active initially. */
  activeSiteKeys:       ['pokeprices'] as const,
  /** Minimum eligibility in cents (> $3). */
  minCents:             301,
} as const

export type RefreshOutcome = {
  started_at:               string
  finished_at:              string
  status:                   'disabled' | 'no_lock' | 'ok' | 'partial' | 'halted_auth' | 'halted_rate_limit' | 'budget_exhausted' | 'no_candidates'
  reason?:                  string
  reserved_slots:           number
  requests_sent:            number
  successes:                number
  failures:                 number
  halted_by?:               string
  halt_retry_after_seconds?: number
  cohort_slots_target:      number
  first_time_slots_target:  number
  cohort_slots_used:        number
  first_time_slots_used:    number
  per_item_errors:          Array<{ spec_id: string; error: string }>
}

export type CandidateRow = {
  id:                        number
  site_key:                  string
  internal_id:               string
  psa_spec_id:               string
  raw_usd_cents:             number | null
  priority_rank:             number | null
  last_refresh_success_at:   string | null
  /** Identity fields used for the deterministic write-through to legacy
   *  psa_population. A write-through targets ONLY rows whose spec_id
   *  AND set+number+variant all match. See cn_psa_writethrough_pokepop
   *  RPC in the migration. */
  set_name:                  string | null
  card_number:               string | null
  variant:                   string | null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Pokemon-only queue selector.
 *
 *  Returns two lists:
 *    cohortDues:   verified cards IN the priority cohort, ordered by
 *                  oldest last_refresh_success_at first (never-refreshed
 *                  cohort members get preference as "first-cohort-pass").
 *    firstTimers:  verified cards NOT in the cohort, never refreshed,
 *                  by raw_usd_cents DESC.
 *
 *  Starvation guard: if cohort has nothing due, firstTimers absorbs
 *  the full budget. If firstTimers is empty (all verified non-cohort
 *  cards already refreshed once), cohort absorbs the full budget. */
export async function selectBatch(
  sb: SupabaseClient,
  cohortSlots: number,
  firstTimeSlots: number,
  activeSite: string,
): Promise<{ cohortDues: CandidateRow[]; firstTimers: CandidateRow[] }> {
  const { data: cohort, error: e1 } = await sb
    .from('cn_psa_candidates')
    .select('id, site_key, internal_id, psa_spec_id, raw_usd_cents, priority_rank, last_refresh_success_at, set_name, card_number, variant')
    .eq('site_key', activeSite)
    .eq('mapping_status', 'verified')
    .not('psa_spec_id', 'is', null)
    .not('priority_rank', 'is', null)
    .order('last_refresh_success_at', { ascending: true, nullsFirst: true })
    .order('priority_rank', { ascending: true })
    .limit(cohortSlots)
  if (e1) throw new Error(`[cn-psa] selectBatch cohort: ${e1.message}`)

  const { data: fresh, error: e2 } = await sb
    .from('cn_psa_candidates')
    .select('id, site_key, internal_id, psa_spec_id, raw_usd_cents, priority_rank, last_refresh_success_at, set_name, card_number, variant')
    .eq('site_key', activeSite)
    .eq('mapping_status', 'verified')
    .not('psa_spec_id', 'is', null)
    .is('priority_rank', null)
    .is('last_refresh_success_at', null)
    .order('raw_usd_cents', { ascending: false, nullsFirst: false })
    .limit(firstTimeSlots)
  if (e2) throw new Error(`[cn-psa] selectBatch firstTimers: ${e2.message}`)

  return {
    cohortDues:  (cohort ?? []) as CandidateRow[],
    firstTimers: (fresh ?? [])  as CandidateRow[],
  }
}

async function upsertResult(
  sb: SupabaseClient,
  candidate: CandidateRow,
  payload: PsaSpecPopulationPayload,
  rawJson: unknown,
  observedAt: string,
  snapshotDate: string,
): Promise<{ writethrough: { updated: number; skipped_legacy_dups: number; history_appended: number } | null }> {
  const specId = candidate.psa_spec_id
  // 1. Upsert canonical latest.
  const latestRow = {
    psa_spec_id: specId,
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    raw_response_jsonb: rawJson as unknown,
    ...payload,
    updated_at: observedAt,
  }
  const { error: e1 } = await sb.from('cn_psa_pop_latest').upsert(latestRow, { onConflict: 'psa_spec_id' })
  if (e1) throw new Error(`[cn-psa] upsert latest ${specId}: ${e1.message}`)

  // 2. Idempotent history append (unique on spec,snapshot).
  const historyRow = {
    psa_spec_id: specId,
    snapshot_date: snapshotDate,
    observed_at: observedAt,
    ...payload,
  }
  const { error: e2 } = await sb
    .from('cn_psa_pop_history')
    .upsert(historyRow, { onConflict: 'psa_spec_id,snapshot_date' })
  if (e2) throw new Error(`[cn-psa] history ${specId}: ${e2.message}`)

  // 3. Pokémon display write-through.
  //    The RPC updates ONLY psa_population rows whose identity matches
  //    the verified candidate: (psa_spec_id, bare set_name, card_number,
  //    variant). Legacy duplicates that share spec_id but carry a
  //    different set-name label are NOT overwritten — they are enqueued
  //    into cn_psa_mapping_review for operator attention.
  //    See migration cn_psa_writethrough_pokepop() for the SQL contract.
  if (candidate.site_key !== 'pokeprices') {
    return { writethrough: null }  // only Pokémon is active; nothing to update
  }
  const { data: wt, error: e3 } = await sb.rpc('cn_psa_writethrough_pokepop', {
    p_psa_spec_id:   specId,
    p_snapshot_date: snapshotDate,
    p_candidate_set: stripPokemonPrefix(candidate.set_name ?? ''),
    p_candidate_num: candidate.card_number ?? '',
    p_candidate_var: candidate.variant ?? '',
  })
  if (e3) {
    // Write-through failure must not fail the ingest — the canonical
    // data has already landed in cn_psa_pop_latest. Surface via error
    // to the caller so the candidate row records it.
    throw new Error(`[cn-psa] writethrough ${specId}: ${e3.message}`)
  }
  const stats = (wt ?? null) as { updated: number; skipped_legacy_dups: number; history_appended: number } | null
  return { writethrough: stats }
}

/** Strip a leading "Pokemon " prefix exactly once (case-insensitive).
 *  The legacy psa_population set_name is 'Pokemon <X>' for every row we've
 *  observed, while candidate.set_name (sourced from cards) is the bare 'X'. */
function stripPokemonPrefix(s: string): string {
  return s.replace(/^Pokemon\s+/i, '')
}

async function markCandidateSuccess(
  sb: SupabaseClient,
  candidateId: number,
  observedAt: string,
): Promise<void> {
  const { error } = await sb.from('cn_psa_candidates').update({
    last_refresh_attempt_at: observedAt,
    last_refresh_success_at: observedAt,
    last_refresh_error: null,
    consecutive_failures: 0,
    updated_at: observedAt,
  }).eq('id', candidateId)
  if (error) throw new Error(`[cn-psa] mark success ${candidateId}: ${error.message}`)
}

async function markCandidateFailure(
  sb: SupabaseClient,
  candidateId: number,
  observedAt: string,
  errorMessage: string,
): Promise<void> {
  const { error } = await sb.rpc('cn_psa_record_candidate_failure', {
    p_candidate_id: candidateId,
    p_observed_at:  observedAt,
    p_error:        errorMessage.slice(0, 500),
  })
  if (error) throw new Error(`[cn-psa] record failure ${candidateId}: ${error.message}`)
}

/** Single bounded run of the scheduler. Never throws on routine errors;
 *  returns a structured outcome the cron route logs into network_job_runs. */
export async function runOnce(sb: SupabaseClient): Promise<RefreshOutcome> {
  const startedAt = new Date().toISOString()
  const out: RefreshOutcome = {
    started_at: startedAt,
    finished_at: startedAt,
    status: 'ok',
    reserved_slots: 0,
    requests_sent: 0,
    successes: 0,
    failures: 0,
    cohort_slots_target: 0,
    first_time_slots_target: 0,
    cohort_slots_used: 0,
    first_time_slots_used: 0,
    per_item_errors: [],
  }

  // 1. Flag gate.
  const flagEnabled = (process.env['CN_PSA_REFRESH_ENABLED'] ?? '').trim() === '1'
  const hasToken = !!(process.env['PSA_PUBLIC_API_TOKEN'] ?? '').trim()
  if (!flagEnabled || !hasToken) {
    out.status = 'disabled'
    out.reason = !flagEnabled ? 'CN_PSA_REFRESH_ENABLED != 1' : 'PSA_PUBLIC_API_TOKEN not set'
    out.finished_at = new Date().toISOString()
    return out
  }

  const utcDate = startedAt.slice(0, 10)
  const lockToken = randomUUID()

  // 2. Acquire lock.
  const { data: locked, error: lockErr } = await sb.rpc('cn_psa_acquire_lock', {
    p_date: utcDate, p_token: lockToken, p_ttl_seconds: CONFIG.lockTtlSeconds,
  })
  if (lockErr) throw new Error(`[cn-psa] acquire lock: ${lockErr.message}`)
  if (locked !== true) {
    out.status = 'no_lock'
    out.reason = 'another process holds today\'s lock'
    out.finished_at = new Date().toISOString()
    return out
  }

  try {
    // 3. Reserve slots atomically — the single arbiter of the daily cap.
    //    Each slot reserved corresponds to one API ATTEMPT (success or fail).
    const { data: reserved, error: resErr } = await sb.rpc('cn_psa_reserve_slots', {
      p_date: utcDate, p_requested: CONFIG.batchTarget,
    })
    if (resErr) throw new Error(`[cn-psa] reserve slots: ${resErr.message}`)
    const reservedN = Number(reserved ?? 0)
    out.reserved_slots = reservedN
    if (reservedN <= 0) {
      out.status = 'budget_exhausted'
      out.reason = 'daily cap reached'
      out.finished_at = new Date().toISOString()
      return out
    }

    // 4. Recompute priority cohort for the active site.
    for (const site of CONFIG.activeSiteKeys) {
      const { error: prErr } = await sb.rpc('cn_psa_recompute_priority', {
        p_site_key: site, p_cohort_size: CONFIG.priorityCohortSize,
      })
      if (prErr) throw new Error(`[cn-psa] recompute priority (${site}): ${prErr.message}`)
    }

    // 5. Split the reserved budget between cohort rotation and first-time coverage.
    const targetCohort = Math.min(
      reservedN,
      Math.ceil(CONFIG.priorityCohortSize / CONFIG.cohortRotationDays),
    )
    const targetFirst = reservedN - targetCohort
    out.cohort_slots_target = targetCohort
    out.first_time_slots_target = targetFirst

    const activeSite = CONFIG.activeSiteKeys[0]  // Pokemon only at bootstrap
    const { cohortDues, firstTimers } = await selectBatch(sb, targetCohort, targetFirst, activeSite)

    // 6. Compose final batch. If one bucket is short, absorb into the other.
    let batch: CandidateRow[] = []
    batch = batch.concat(cohortDues.slice(0, targetCohort))
    batch = batch.concat(firstTimers.slice(0, targetFirst))
    const shortfall = reservedN - batch.length
    if (shortfall > 0) {
      // Pull the overflow list from whichever bucket has more.
      const extraFirst = firstTimers.slice(targetFirst, targetFirst + shortfall)
      const extraCohort = cohortDues.slice(targetCohort, targetCohort + shortfall)
      batch = batch.concat(extraFirst, extraCohort).slice(0, reservedN)
    }

    if (batch.length === 0) {
      out.status = 'no_candidates'
      out.reason = 'no verified candidates due or new'
      out.finished_at = new Date().toISOString()
      return out
    }

    // 7. Execute each attempt.
    for (const c of batch) {
      out.requests_sent += 1
      if (c.priority_rank != null && c.last_refresh_success_at != null) out.cohort_slots_used += 1
      else out.first_time_slots_used += 1

      const result = await fetchPsaSpecPopulation(c.psa_spec_id, {
        timeoutMs: CONFIG.fetchTimeoutMs,
      })
      const attemptAt = new Date().toISOString()

      if (!result.ok) {
        out.failures += 1
        out.per_item_errors.push({ spec_id: c.psa_spec_id, error: `${result.error.kind}: ${result.error.message}` })
        await markCandidateFailure(sb, c.id, attemptAt, `${result.error.kind}: ${result.error.message}`)
        if (result.error.kind === 'unauthorized' || result.error.kind === 'forbidden') {
          out.status = 'halted_auth'
          out.halted_by = result.error.kind
          out.halt_retry_after_seconds = result.error.retryAfterSeconds
          break
        }
        if (result.error.kind === 'rate_limited') {
          out.status = 'halted_rate_limit'
          out.halted_by = result.error.kind
          out.halt_retry_after_seconds = result.error.retryAfterSeconds
          break
        }
        await sleep(CONFIG.perRequestDelayMs)
        continue
      }

      // Observation date = today (our HTTP retrieval). PSA's upstream
      // snapshot date is not separately returned, so we record the
      // retrieval date as the display's "as of".
      const observedAt = attemptAt
      const snapshotDate = observedAt.slice(0, 10)
      try {
        const { writethrough } = await upsertResult(sb, c, result.payload, result.rawJson, observedAt, snapshotDate)
        await markCandidateSuccess(sb, c.id, observedAt)
        out.successes += 1
        if (writethrough && writethrough.skipped_legacy_dups > 0) {
          // Non-fatal — a legacy duplicate was preserved and queued for
          // operator review. Record it in per-item errors so the cron
          // response surface shows it in the Hub job metadata.
          out.per_item_errors.push({
            spec_id: c.psa_spec_id,
            error: `writethrough: ${writethrough.updated} updated, ${writethrough.skipped_legacy_dups} legacy duplicate(s) preserved for review`,
          })
        }
      } catch (e) {
        out.failures += 1
        const msg = e instanceof Error ? e.message : 'persist error'
        out.per_item_errors.push({ spec_id: c.psa_spec_id, error: `persist: ${msg.slice(0, 200)}` })
        await markCandidateFailure(sb, c.id, attemptAt, `persist: ${msg.slice(0, 200)}`)
      }

      await sleep(CONFIG.perRequestDelayMs)
    }

    if (out.status === 'ok' && out.failures > 0 && out.successes === 0) out.status = 'partial'
  } finally {
    const releaseStatus =
      out.status === 'halted_auth' ? 'halted_auth'
      : out.status === 'halted_rate_limit' ? 'halted_rate_limit'
      : 'idle'
    await sb.rpc('cn_psa_release_lock', { p_date: utcDate, p_token: lockToken, p_last_status: releaseStatus })
  }

  out.finished_at = new Date().toISOString()
  return out
}
