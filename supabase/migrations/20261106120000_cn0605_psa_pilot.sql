-- CN-06.05-P04: lifetime-budget + dry-run pilot gate.
--
-- Rationale: the P03 daily cap is per-UTC-date; a 5/day cap over 30 days
-- allows 150 calls over the pilot window. The user requires a genuine
-- ONE-SHOT pilot: no more than 5 total API attempts across all time,
-- counting failures, persisted across deploys/crons/UTC boundaries.
--
-- Design:
--   * cn_psa_pilot is a SINGLETON config row (id=TRUE enforced by CHECK).
--   * While `active` is TRUE, the scheduler is in PILOT MODE:
--       - API calls require a pilot-slot reservation.
--       - reserved count = lifetime_attempts_used (every attempt, incl.
--         failures). When used >= cap, pilot auto-flips active=FALSE.
--       - If `dry_run` is TRUE, the scheduler skips the write-through
--         to legacy psa_population / psa_pop_history so no live display
--         is modified. Canonical cn_psa_pop_latest still receives the
--         parsed response (so operator can inspect).
--   * While `active` is FALSE, the scheduler EXITS DISABLED. Routine
--     daily operation requires a separate future flag; NOT enabled here.
--
-- Safety invariants (enforced here + tested):
--   * Only one row can ever exist (id=TRUE CHECK).
--   * lifetime_attempts_used increments monotonically; there is no path
--     that decreases it.
--   * The reserve RPC uses FOR UPDATE to serialise concurrent fires.
--   * Auto-completion flips active=FALSE and writes completed_at; the
--     scheduler reads these on every fire.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cn_psa_pilot (
  id                       boolean PRIMARY KEY DEFAULT TRUE,
  active                   boolean NOT NULL DEFAULT FALSE,
  lifetime_cap             integer NOT NULL DEFAULT 5,
  lifetime_attempts_used   integer NOT NULL DEFAULT 0,
  dry_run                  boolean NOT NULL DEFAULT TRUE,
  started_at               timestamptz,
  completed_at             timestamptz,
  last_status              text,
  last_updated_by          text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cn_psa_pilot_singleton_ck CHECK (id = TRUE),
  CONSTRAINT cn_psa_pilot_cap_ck       CHECK (lifetime_cap >= 0),
  CONSTRAINT cn_psa_pilot_used_ck      CHECK (lifetime_attempts_used >= 0)
);

-- Ensure the singleton row exists in an inactive state. Idempotent.
INSERT INTO public.cn_psa_pilot (id, active, lifetime_cap, lifetime_attempts_used, dry_run, last_status)
VALUES (TRUE, FALSE, 5, 0, TRUE, 'initialized')
    ON CONFLICT (id) DO NOTHING;


-- Reserve one pilot attempt. Returns TRUE if reserved (caller may make
-- ONE API call); FALSE if pilot is inactive or exhausted (caller must
-- NOT issue an API call). Uses FOR UPDATE to serialise concurrent fires.
CREATE OR REPLACE FUNCTION public.cn_psa_pilot_reserve_attempt()
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_active boolean;
  v_cap    integer;
  v_used   integer;
BEGIN
  SELECT active, lifetime_cap, lifetime_attempts_used
    INTO v_active, v_cap, v_used
    FROM public.cn_psa_pilot
   WHERE id = TRUE
     FOR UPDATE;

  IF NOT v_active THEN
    RETURN FALSE;
  END IF;

  IF v_used >= v_cap THEN
    -- Already exhausted; auto-complete if not yet marked.
    UPDATE public.cn_psa_pilot
       SET active      = FALSE,
           completed_at = COALESCE(completed_at, now()),
           last_status = 'exhausted',
           updated_at  = now()
     WHERE id = TRUE;
    RETURN FALSE;
  END IF;

  UPDATE public.cn_psa_pilot
     SET lifetime_attempts_used = v_used + 1,
         started_at             = COALESCE(started_at, now()),
         last_status            = CASE WHEN v_used + 1 >= v_cap THEN 'exhausted' ELSE 'in_progress' END,
         active                 = CASE WHEN v_used + 1 >= v_cap THEN FALSE ELSE TRUE END,
         completed_at           = CASE WHEN v_used + 1 >= v_cap THEN COALESCE(completed_at, now()) ELSE completed_at END,
         updated_at             = now()
   WHERE id = TRUE;

  RETURN TRUE;
END;
$$;


-- Admin helper for the operator to initialise or reset the pilot. Only
-- allowed to REDUCE lifetime_cap below 5 (safety) and to set active
-- when lifetime_attempts_used < lifetime_cap. Never resets used.
CREATE OR REPLACE FUNCTION public.cn_psa_pilot_arm(
  p_lifetime_cap integer,
  p_dry_run      boolean,
  p_updated_by   text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_used integer;
  v_old_cap integer;
BEGIN
  IF p_lifetime_cap IS NULL OR p_lifetime_cap <= 0 OR p_lifetime_cap > 5 THEN
    RAISE EXCEPTION 'cn_psa_pilot_arm: p_lifetime_cap must be 1..5';
  END IF;

  SELECT lifetime_attempts_used, lifetime_cap
    INTO v_used, v_old_cap
    FROM public.cn_psa_pilot
   WHERE id = TRUE
     FOR UPDATE;

  IF v_used >= p_lifetime_cap THEN
    RAISE EXCEPTION 'cn_psa_pilot_arm: cannot arm; used=% already >= requested cap=%', v_used, p_lifetime_cap;
  END IF;

  UPDATE public.cn_psa_pilot
     SET active          = TRUE,
         lifetime_cap    = p_lifetime_cap,
         dry_run         = COALESCE(p_dry_run, dry_run),
         last_status     = 'armed',
         last_updated_by = p_updated_by,
         started_at      = COALESCE(started_at, now()),
         updated_at      = now()
   WHERE id = TRUE;

  RETURN jsonb_build_object(
    'active', TRUE,
    'lifetime_cap', p_lifetime_cap,
    'lifetime_attempts_used', v_used,
    'remaining', p_lifetime_cap - v_used,
    'dry_run', p_dry_run
  );
END;
$$;

COMMIT;
