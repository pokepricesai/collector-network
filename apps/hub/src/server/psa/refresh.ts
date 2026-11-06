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

/** PSA responses lacking a numeric Total AND lacking any numeric grade
 *  or Auth value are rejected as incomplete. Prevents silent overwrite
 *  of existing counts with nulls. Used by the scheduler BEFORE writes. */
export function isPsaPayloadComplete(p: PsaSpecPopulationPayload): boolean {
  if (p.total_graded == null) return false
  const numericGrades = [
    p.auth, p.psa_1, p.psa_1_5, p.psa_2, p.psa_2_5, p.psa_3, p.psa_3_5,
    p.psa_4, p.psa_4_5, p.psa_5, p.psa_5_5, p.psa_6, p.psa_6_5,
    p.psa_7, p.psa_7_5, p.psa_8, p.psa_8_5, p.psa_9, p.psa_9_5, p.psa_10,
  ]
  const anyNumeric = numericGrades.some(v => v != null)
  // Total>0 with no graded cells is suspicious; accept only if we at
  // least have Auth or any grade.
  return p.total_graded === 0 ? true : anyNumeric
}

/** Checks PSA's returned Description against the candidate's expected
 *  identity (bare set_name + card_number). Accepts if the description
 *  contains both substrings (case-insensitive, whitespace-normalised). */
export function identityMatchesDescription(
  description: string | null,
  candidate: { set_name: string | null; card_number: string | null },
): boolean {
  if (!description) return false
  const haystack = description.toLowerCase().replace(/\s+/g, ' ')
  const bareSet = (candidate.set_name ?? '').replace(/^Pokemon\s+/i, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const num = (candidate.card_number ?? '').toLowerCase().trim()
  if (!bareSet || !num) return false
  if (!haystack.includes(bareSet)) return false
  // PSA often formats numbers as "#N" — accept either plain or "#" prefixed.
  if (!haystack.includes(num) && !haystack.includes('#' + num)) return false
  return true
}

// CN-06.05-P04 pilot gate.
//
// Three additional invariants layered on top of the P03 daily cap:
//   1. Lifetime attempts cap enforced by the cn_psa_pilot singleton.
//      While pilot.active=TRUE, every API attempt must reserve one of
//      <=5 lifetime slots via cn_psa_pilot_reserve_attempt() BEFORE
//      the fetch. Failures count. Reaching cap auto-sets active=FALSE.
//   2. When pilot.dry_run=TRUE, the legacy psa_population /
//      psa_pop_history write-through is SKIPPED. Canonical data still
//      lands in cn_psa_pop_latest / cn_psa_pop_history so the
//      operator can inspect, but no public-facing display is modified.
//   3. Completeness + identity verification BEFORE the legacy write
//      (when not dry_run):
//        - PSA response MUST include a numeric Total AND at least one
//          numeric grade value (incl. Auth). Otherwise rejected.
//        - PSA Description MUST contain the candidate set_name and
//          card_number as substrings (case-insensitive). Otherwise
//          rejected. The scheduler records the mismatch into the
//          candidate's mapping_notes + per_item_errors; no write.

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
  status:                   'disabled' | 'no_lock' | 'ok' | 'partial' | 'halted_auth' | 'halted_rate_limit' | 'budget_exhausted' | 'no_candidates' | 'pilot_exhausted' | 'pilot_inactive'
  reason?:                  string
  pilot_mode:               boolean
  dry_run:                  boolean
  lifetime_cap?:            number
  lifetime_used_before?:    number
  lifetime_used_after?:     number
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
  per_item_identity_checks: Array<{ spec_id: string; description: string | null; identity_ok: boolean }>
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
  dryRun: boolean,
): Promise<{ writethrough: { updated: number; skipped_legacy_dups: number; history_appended: number } | null }> {
  const specId = candidate.psa_spec_id
  // 1. Upsert canonical latest — always written (canonical store, operator-inspectable).
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

  // 2. Idempotent history append (unique on spec,snapshot) — always written.
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

  // 3. Pokémon display write-through — SKIPPED in dry_run.
  //    When live, the RPC updates ONLY psa_population rows whose identity
  //    matches the candidate (spec_id + bare set_name + card_number + variant);
  //    legacy duplicates are enqueued into cn_psa_mapping_review.
  if (dryRun)                                 return { writethrough: null }
  if (candidate.site_key !== 'pokeprices')    return { writethrough: null }
  const { data: wt, error: e3 } = await sb.rpc('cn_psa_writethrough_pokepop', {
    p_psa_spec_id:   specId,
    p_snapshot_date: snapshotDate,
    p_candidate_set: stripPokemonPrefix(candidate.set_name ?? ''),
    p_candidate_num: candidate.card_number ?? '',
    p_candidate_var: candidate.variant ?? '',
  })
  if (e3) throw new Error(`[cn-psa] writethrough ${specId}: ${e3.message}`)
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

type PilotRow = {
  active: boolean
  lifetime_cap: number
  lifetime_attempts_used: number
  dry_run: boolean
}

/** Fetch the singleton pilot config. Returns null if the table is absent
 *  (e.g. migration not yet applied in a particular environment). */
async function readPilot(sb: SupabaseClient): Promise<PilotRow | null> {
  const { data, error } = await sb.from('cn_psa_pilot')
    .select('active, lifetime_cap, lifetime_attempts_used, dry_run')
    .eq('id', true).maybeSingle()
  if (error) {
    // Treat PGRST205 (table absent) same as "no pilot row" — scheduler exits.
    if ((error as any).code === 'PGRST205') return null
    throw new Error(`[cn-psa] read pilot: ${error.message}`)
  }
  return (data ?? null) as PilotRow | null
}

/** Single bounded run of the scheduler. Never throws on routine errors;
 *  returns a structured outcome the cron route logs into network_job_runs. */
export async function runOnce(sb: SupabaseClient): Promise<RefreshOutcome> {
  const startedAt = new Date().toISOString()
  const out: RefreshOutcome = {
    started_at: startedAt,
    finished_at: startedAt,
    status: 'ok',
    pilot_mode: false,
    dry_run: false,
    reserved_slots: 0,
    requests_sent: 0,
    successes: 0,
    failures: 0,
    cohort_slots_target: 0,
    first_time_slots_target: 0,
    cohort_slots_used: 0,
    first_time_slots_used: 0,
    per_item_errors: [],
    per_item_identity_checks: [],
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

  // 2. Pilot gate. Pilot MUST be active and have remaining lifetime
  //    slots. Otherwise exit — routine daily operation is not enabled.
  const pilot = await readPilot(sb)
  if (!pilot) {
    out.status = 'pilot_inactive'
    out.reason = 'cn_psa_pilot singleton not found (migration not applied?)'
    out.finished_at = new Date().toISOString()
    return out
  }
  out.pilot_mode = pilot.active
  out.dry_run = pilot.dry_run
  out.lifetime_cap = pilot.lifetime_cap
  out.lifetime_used_before = pilot.lifetime_attempts_used
  if (!pilot.active) {
    out.status = 'pilot_inactive'
    out.reason = 'cn_psa_pilot.active = FALSE; routine mode requires separate approval'
    out.finished_at = new Date().toISOString()
    return out
  }
  if (pilot.lifetime_attempts_used >= pilot.lifetime_cap) {
    out.status = 'pilot_exhausted'
    out.reason = `pilot lifetime_cap reached (${pilot.lifetime_attempts_used}/${pilot.lifetime_cap})`
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
    //
    //    Pilot invariant: before every HTTP call, reserve ONE lifetime
    //    pilot slot via cn_psa_pilot_reserve_attempt. If the RPC
    //    returns FALSE (exhausted or deactivated mid-batch) we halt
    //    immediately — no further calls. Every attempt (incl. failures)
    //    has already decremented the slot by the time we evaluate the
    //    HTTP result.
    for (const c of batch) {
      // Pilot slot reservation — authoritative gate for the lifetime cap.
      const { data: reservedPilot, error: rpErr } = await sb.rpc('cn_psa_pilot_reserve_attempt')
      if (rpErr) throw new Error(`[cn-psa] pilot reserve: ${rpErr.message}`)
      if (reservedPilot !== true) {
        out.status = 'pilot_exhausted'
        out.reason = 'cn_psa_pilot exhausted mid-batch'
        break
      }

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

      // Identity verification — compare PSA's returned Description
      // against the candidate's expected (set, number). This is a soft
      // gate in dry-run (surfaced for operator review) and a HARD gate
      // live (skip legacy write-through if mismatch).
      const identityOk = identityMatchesDescription(result.description, c)
      out.per_item_identity_checks.push({
        spec_id: c.psa_spec_id,
        description: result.description,
        identity_ok: identityOk,
      })

      // Completeness check — reject PSA responses lacking a numeric
      // Total AND any numeric grade/Auth. Prevents silent overwrite
      // of existing counts with nulls or synthetic zeros.
      const isComplete = isPsaPayloadComplete(result.payload)
      if (!isComplete) {
        out.failures += 1
        out.per_item_errors.push({ spec_id: c.psa_spec_id, error: 'incomplete: response lacks Total or all grade values' })
        await markCandidateFailure(sb, c.id, attemptAt, 'incomplete PSA response (Total missing or no numeric grades)')
        await sleep(CONFIG.perRequestDelayMs)
        continue
      }

      // When live (not dry_run) AND identity failed → refuse the write-through.
      // Still record the canonical fetch in cn_psa_pop_latest for inspection.
      const observedAt = attemptAt
      const snapshotDate = observedAt.slice(0, 10)
      const effectiveDryRun = pilot.dry_run || !identityOk
      try {
        const { writethrough } = await upsertResult(sb, c, result.payload, result.rawJson, observedAt, snapshotDate, effectiveDryRun)
        await markCandidateSuccess(sb, c.id, observedAt)
        out.successes += 1
        if (!identityOk) {
          out.per_item_errors.push({
            spec_id: c.psa_spec_id,
            error: `identity: PSA Description "${(result.description ?? '').slice(0,80)}" does not match candidate (set=${c.set_name} num=${c.card_number}); legacy write-through skipped`,
          })
        }
        if (writethrough && writethrough.skipped_legacy_dups > 0) {
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

    // Record the post-batch pilot-counter state (best-effort; never fatal).
    try {
      const postPilot = await readPilot(sb)
      if (postPilot) out.lifetime_used_after = postPilot.lifetime_attempts_used
    } catch { /* ignore */ }
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
