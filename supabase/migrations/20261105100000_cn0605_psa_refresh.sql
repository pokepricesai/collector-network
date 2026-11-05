-- CN-06.05-P03: PSA population refresh system (Hub-owned, 5-site, flag OFF).
--
-- Design summary (post-architecture-review):
--   * Operational tables (new):
--       cn_psa_candidates          — eligibility + queue state (NOT a pop store)
--       cn_psa_api_usage           — atomic daily counter + lock
--       cn_psa_mapping_review      — operator-reviewed mapping queue
--   * Canonical population ingest targets (new):
--       cn_psa_pop_latest          — one row per psa_spec_id (upsert on PK)
--       cn_psa_pop_history         — append-only, UNIQUE (spec, snapshot)
--   * Display backfill (write-through):
--       After every successful API response the cron ALSO updates
--       `psa_population` (Pokemon display) and appends to
--       `psa_pop_history` so the existing extras/CardPageClient path
--       (see P02 "PSA population as of …" label) shows the fresh date
--       without any schema or code change on the display side.
--
-- Why not reuse `psa_population` as the primary target?
--   464 (psa_spec_id, variant) duplicates in the legacy table carry
--   DIFFERENT grade values — i.e., the legacy scraper produced real
--   conflicts for 464 pairs. Adding a UNIQUE constraint would require
--   human judgement per conflict. Keeping the new `cn_psa_*` tables as
--   the authoritative store avoids that migration risk. The write-
--   through covers ALL rows matching psa_spec_id, so legacy duplicates
--   receive the same fresh grade data. Operators who later dedupe
--   `psa_population` can remove the write-through in one line.
--
-- Safety notes:
--   * No existing table ALTERed.
--   * No existing data touched.
--   * Idempotent — safe to re-run.
--   * Feature flag CN_PSA_REFRESH_ENABLED default off; PSA_PUBLIC_API_TOKEN
--     required; without either the cron exits as 'disabled'.

BEGIN;

-- 1. Candidate list. Eligibility + mapping + queue state.
CREATE TABLE IF NOT EXISTS public.cn_psa_candidates (
  id                        bigserial PRIMARY KEY,
  site_key                  text        NOT NULL,
  internal_id               text        NOT NULL,
  psa_spec_id               text,
  mapping_status            text        NOT NULL,
  --   'verified'   — operator-confirmed deterministic match
  --   'plausible'  — exactly one fuzzy match; needs review before refresh
  --   'ambiguous'  — multiple candidate spec_ids; needs review
  --   'unmapped'   — no match found or TCG game awaiting operator supply
  --   'rejected'   — known-bad mapping, excluded from all workflows
  raw_usd_cents             integer,
  raw_price_observed_at     timestamptz,
  raw_price_source          text,
  set_name                  text,
  card_number               text,
  card_name                 text,
  language                  text,
  finish                    text,
  variant                   text,
  mapping_notes             text,
  last_refresh_attempt_at   timestamptz,
  last_refresh_success_at   timestamptz,
  last_refresh_error        text,
  consecutive_failures      integer     NOT NULL DEFAULT 0,
  priority_rank             integer,            -- recomputed daily; NULL = outside priority cohort
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cn_psa_candidates_site_internal_u UNIQUE (site_key, internal_id),
  CONSTRAINT cn_psa_candidates_mapping_status_ck
    CHECK (mapping_status IN ('verified','plausible','ambiguous','unmapped','rejected'))
);

-- Queue scanner — only verified AND site active (Pokémon-only initially).
CREATE INDEX IF NOT EXISTS cn_psa_candidates_queue_idx
  ON public.cn_psa_candidates (site_key, mapping_status, priority_rank NULLS LAST, raw_usd_cents DESC)
  WHERE mapping_status = 'verified';

CREATE INDEX IF NOT EXISTS cn_psa_candidates_by_spec_idx
  ON public.cn_psa_candidates (psa_spec_id)
  WHERE psa_spec_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cn_psa_candidates_review_idx
  ON public.cn_psa_candidates (site_key, mapping_status)
  WHERE mapping_status IN ('plausible','ambiguous');


-- 2. Latest observed PSA population per spec_id (upsert target).
CREATE TABLE IF NOT EXISTS public.cn_psa_pop_latest (
  psa_spec_id           text PRIMARY KEY,
  snapshot_date         date        NOT NULL,
  observed_at           timestamptz NOT NULL,       -- our HTTP retrieval time
  auth                  integer,
  psa_1                 integer, psa_1_5 integer,
  psa_2                 integer, psa_2_5 integer,
  psa_3                 integer, psa_3_5 integer,
  psa_4                 integer, psa_4_5 integer,
  psa_5                 integer, psa_5_5 integer,
  psa_6                 integer, psa_6_5 integer,
  psa_7                 integer, psa_7_5 integer,
  psa_8                 integer, psa_8_5 integer,
  psa_9                 integer, psa_9_5 integer,
  psa_10                integer,
  qualified_total       integer,
  total_graded          integer,
  gem_rate              numeric(5,2),
  raw_response_jsonb    jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now()
);


-- 3. Append-only history (unique per spec+snapshot).
CREATE TABLE IF NOT EXISTS public.cn_psa_pop_history (
  psa_spec_id       text        NOT NULL,
  snapshot_date     date        NOT NULL,
  observed_at       timestamptz NOT NULL,
  auth              integer,
  psa_1             integer, psa_1_5 integer,
  psa_2             integer, psa_2_5 integer,
  psa_3             integer, psa_3_5 integer,
  psa_4             integer, psa_4_5 integer,
  psa_5             integer, psa_5_5 integer,
  psa_6             integer, psa_6_5 integer,
  psa_7             integer, psa_7_5 integer,
  psa_8             integer, psa_8_5 integer,
  psa_9             integer, psa_9_5 integer,
  psa_10            integer,
  qualified_total   integer,
  total_graded      integer,
  gem_rate          numeric(5,2),
  PRIMARY KEY (psa_spec_id, snapshot_date)
);


-- 4. Atomic daily counter + lock.
CREATE TABLE IF NOT EXISTS public.cn_psa_api_usage (
  utc_date           date        PRIMARY KEY,
  requests_sent      integer     NOT NULL DEFAULT 0,
  planned_cap        integer     NOT NULL,           -- default 90
  hard_cap           integer     NOT NULL,           -- default 100
  lock_token         uuid,
  lock_acquired_at   timestamptz,
  lock_expires_at    timestamptz,
  last_status        text,
  last_error_code    text,
  last_error_at      timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);


-- 5. Review queue.
CREATE TABLE IF NOT EXISTS public.cn_psa_mapping_review (
  id                    bigserial PRIMARY KEY,
  site_key              text        NOT NULL,
  internal_id           text        NOT NULL,
  candidate_spec_ids    text[],
  conflict_reason       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  resolution_spec_id    text,
  resolution_action     text,
  resolved_by           text,
  CONSTRAINT cn_psa_mapping_review_unique UNIQUE (site_key, internal_id)
);


-- 6. Atomic slot reservation. Returns the number of slots actually
--    granted, clamped so (requests_sent + granted) never exceeds
--    hard_cap. Every API ATTEMPT must call this exactly once before
--    issuing the HTTP request; failed attempts remain counted.
--
--    Correctness: SELECT ... FOR UPDATE row-locks the usage row, so
--    concurrent calls serialize. The granted count is computed from
--    the LOCKED pre-state and the UPDATE reflects exactly that grant.
CREATE OR REPLACE FUNCTION public.cn_psa_reserve_slots(
  p_date      date,
  p_requested integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_sent    integer;
  v_hard    integer;
  v_granted integer;
BEGIN
  INSERT INTO public.cn_psa_api_usage (utc_date, planned_cap, hard_cap)
    VALUES (p_date, 90, 100)
    ON CONFLICT (utc_date) DO NOTHING;

  -- Row-lock + read current state. Concurrent callers serialize here.
  SELECT requests_sent, hard_cap INTO v_sent, v_hard
    FROM public.cn_psa_api_usage
   WHERE utc_date = p_date
     FOR UPDATE;

  v_granted := LEAST(p_requested, GREATEST(0, v_hard - v_sent));

  IF v_granted > 0 THEN
    UPDATE public.cn_psa_api_usage
       SET requests_sent = v_sent + v_granted,
           updated_at    = now()
     WHERE utc_date = p_date;
  END IF;

  RETURN v_granted;
END;
$$;


-- 7. Lock acquisition — single-writer discipline per UTC day.
CREATE OR REPLACE FUNCTION public.cn_psa_acquire_lock(
  p_date          date,
  p_token         uuid,
  p_ttl_seconds   integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  INSERT INTO public.cn_psa_api_usage (utc_date, planned_cap, hard_cap)
    VALUES (p_date, 90, 100)
    ON CONFLICT (utc_date) DO NOTHING;

  UPDATE public.cn_psa_api_usage
    SET lock_token       = p_token,
        lock_acquired_at = now(),
        lock_expires_at  = now() + make_interval(secs => p_ttl_seconds),
        last_status      = 'running',
        updated_at       = now()
    WHERE utc_date = p_date
      AND (lock_token IS NULL OR lock_expires_at < now());
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;


-- 8a. Record candidate failure atomically.
CREATE OR REPLACE FUNCTION public.cn_psa_record_candidate_failure(
  p_candidate_id bigint,
  p_observed_at  timestamptz,
  p_error        text
) RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.cn_psa_candidates
     SET last_refresh_attempt_at = p_observed_at,
         last_refresh_error      = p_error,
         consecutive_failures    = consecutive_failures + 1,
         updated_at              = now()
   WHERE id = p_candidate_id;
$$;


-- 8b. Release lock (only the holder's token).
CREATE OR REPLACE FUNCTION public.cn_psa_release_lock(
  p_date  date,
  p_token uuid,
  p_last_status text
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.cn_psa_api_usage
    SET lock_token       = NULL,
        lock_acquired_at = NULL,
        lock_expires_at  = NULL,
        last_status      = COALESCE(p_last_status, 'idle'),
        updated_at       = now()
    WHERE utc_date = p_date AND lock_token = p_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;


-- 9. Recompute the priority cohort: top N verified rows by raw_usd_cents.
--    Called at the top of every cron fire. Sets priority_rank = 1..N
--    on the top N, clears rank on everything else. The queue selector
--    uses this to pick cohort-due refreshes vs first-timers.
CREATE OR REPLACE FUNCTION public.cn_psa_recompute_priority(
  p_site_key text,
  p_cohort_size integer
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated integer;
BEGIN
  -- Clear old ranks for this site.
  UPDATE public.cn_psa_candidates
     SET priority_rank = NULL
   WHERE site_key = p_site_key AND priority_rank IS NOT NULL;

  -- Assign ranks 1..N to top verified candidates.
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY raw_usd_cents DESC NULLS LAST, id) AS rnk
      FROM public.cn_psa_candidates
     WHERE site_key = p_site_key
       AND mapping_status = 'verified'
       AND psa_spec_id IS NOT NULL
     LIMIT p_cohort_size
  )
  UPDATE public.cn_psa_candidates c
     SET priority_rank = r.rnk
    FROM ranked r
   WHERE c.id = r.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;


-- 10. Pokémon display write-through — DETERMINISTIC identity match only.
--
-- Legacy duplicates audit (CN-06.05 pre-merge, 2026-11-05):
--   • 344 duplicates share spec_id+variant AND identical grade data
--     (benign scraper-level duplicates).
--   • 464 duplicates share spec_id+variant BUT have DIFFERENT grade
--     values. Every pair examined was the SAME PSA spec with different
--     legacy set-name labels — e.g. "Pokemon 1999 Topps Movie" vs
--     "Pokemon Topps Pokemon the Movie Edt". None represented genuinely
--     different cards sharing a spec_id. Even so this function REFUSES
--     to overwrite a row whose identity differs from the verified
--     candidate; it logs the preserved row into cn_psa_mapping_review.
--
-- Returns jsonb: { updated, skipped_legacy_dups, history_appended }.
CREATE OR REPLACE FUNCTION public.cn_psa_writethrough_pokepop(
  p_psa_spec_id   text,
  p_snapshot_date date,
  p_candidate_set text,
  p_candidate_num text,
  p_candidate_var text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated   integer := 0;
  v_skipped   integer := 0;
  v_inserted  integer := 0;
  v_canon_set text := p_candidate_set;
  v_canon_num text := COALESCE(p_candidate_num, '');
  v_canon_var text := COALESCE(p_candidate_var, '');
BEGIN
  -- 1. UPDATE only rows whose identity matches the verified candidate.
  WITH src AS (
    SELECT * FROM public.cn_psa_pop_latest WHERE psa_spec_id = p_psa_spec_id
  )
  UPDATE public.psa_population pp
     SET auth         = src.auth,
         psa_1        = src.psa_1,   psa_1_5 = src.psa_1_5,
         psa_2        = src.psa_2,
         psa_3        = src.psa_3,
         psa_4        = src.psa_4,
         psa_5        = src.psa_5,
         psa_6        = src.psa_6,
         psa_7        = src.psa_7,
         psa_8        = src.psa_8,
         psa_9        = src.psa_9,
         psa_10       = src.psa_10,
         total_graded = src.total_graded,
         gem_rate     = src.gem_rate,
         scraped_date = src.snapshot_date,
         updated_at   = now()
    FROM src
   WHERE pp.psa_spec_id = p_psa_spec_id
     AND regexp_replace(pp.set_name, '^Pokemon\s+', '', 'i') = v_canon_set
     AND COALESCE(pp.card_number, '') = v_canon_num
     AND COALESCE(pp.variant, '')     = v_canon_var;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 2. Count legacy rows that share spec_id but DIFFER on identity.
  SELECT count(*) INTO v_skipped
    FROM public.psa_population pp
   WHERE pp.psa_spec_id = p_psa_spec_id
     AND NOT (
       regexp_replace(pp.set_name, '^Pokemon\s+', '', 'i') = v_canon_set
       AND COALESCE(pp.card_number, '') = v_canon_num
       AND COALESCE(pp.variant, '')     = v_canon_var
     );

  -- 3. Enqueue each preserved legacy duplicate for operator review.
  IF v_skipped > 0 THEN
    INSERT INTO public.cn_psa_mapping_review (
      site_key, internal_id, candidate_spec_ids, conflict_reason
    )
    SELECT 'pokeprices',
           'legacy-dup:' || pp.id::text,
           ARRAY[p_psa_spec_id]::text[],
           'legacy psa_population row shares spec_id ' || p_psa_spec_id ||
           ' but (set,number,variant) differs from refreshed candidate (' ||
           v_canon_set || ' | ' || v_canon_num || ' | ' || v_canon_var || ')'
      FROM public.psa_population pp
     WHERE pp.psa_spec_id = p_psa_spec_id
       AND NOT (
         regexp_replace(pp.set_name, '^Pokemon\s+', '', 'i') = v_canon_set
         AND COALESCE(pp.card_number, '') = v_canon_num
         AND COALESCE(pp.variant, '')     = v_canon_var
       )
    ON CONFLICT (site_key, internal_id) DO NOTHING;
  END IF;

  -- 4. Append to legacy history (deterministically identified; idempotent
  --    within the UTC day).
  INSERT INTO public.psa_pop_history (
    set_name, card_number, card_name, variant, psa_spec_id,
    psa_1, psa_1_5, psa_2, psa_3, psa_4, psa_5, psa_6, psa_7, psa_8, psa_9, psa_10,
    auth, total_graded, gem_rate, snapshot_date, created_at
  )
  SELECT
    pop.set_name, pop.card_number, pop.card_name, pop.variant, pop.psa_spec_id,
    src.psa_1, src.psa_1_5, src.psa_2, src.psa_3, src.psa_4, src.psa_5,
    src.psa_6, src.psa_7, src.psa_8, src.psa_9, src.psa_10,
    src.auth, src.total_graded, src.gem_rate, p_snapshot_date, now()
    FROM public.cn_psa_pop_latest src
    JOIN public.psa_population pop
      ON pop.psa_spec_id = p_psa_spec_id
     AND regexp_replace(pop.set_name, '^Pokemon\s+', '', 'i') = v_canon_set
     AND COALESCE(pop.card_number, '') = v_canon_num
     AND COALESCE(pop.variant, '')     = v_canon_var
   WHERE src.psa_spec_id = p_psa_spec_id
     AND NOT EXISTS (
       SELECT 1 FROM public.psa_pop_history h
        WHERE h.psa_spec_id = p_psa_spec_id
          AND h.snapshot_date = p_snapshot_date
     )
   LIMIT 1;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'updated',             v_updated,
    'skipped_legacy_dups', v_skipped,
    'history_appended',    v_inserted
  );
END;
$$;

COMMIT;
