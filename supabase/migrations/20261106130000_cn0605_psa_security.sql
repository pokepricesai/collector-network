-- CN-06.05-P04 security lockdown.
--
-- The P03 scaffolding (20261105100000) and the P04 pilot (20261106120000)
-- created 6 tables + 8 RPCs in public schema. Supabase exposes `public`
-- via PostgREST with `anon` and `authenticated` roles. Without RLS or
-- REVOKE, any holder of SUPABASE_ANON_KEY could SELECT/INSERT/UPDATE/
-- DELETE the tables and invoke the admin RPCs — including
-- cn_psa_pilot_arm, which gates the live PSA API.
--
-- This migration:
--   1. ENABLE ROW LEVEL SECURITY on every cn_psa_* table. No CREATE
--      POLICY → anon and authenticated are locked out of all rows.
--      service_role bypasses RLS (Supabase default) so the cron is
--      unaffected.
--   2. REVOKE EXECUTE on every cn_psa_* function from PUBLIC / anon /
--      authenticated. Only service_role (and the postgres superuser
--      the operator uses in Supabase SQL Editor) can invoke them.
--   3. Explicit GRANT EXECUTE to service_role for each function.
--
-- Idempotent. Safe to re-apply.

BEGIN;

-- 1. RLS on all operational and canonical tables.
ALTER TABLE public.cn_psa_candidates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cn_psa_pop_latest     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cn_psa_pop_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cn_psa_api_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cn_psa_mapping_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cn_psa_pilot          ENABLE ROW LEVEL SECURITY;

-- 2. REVOKE + 3. GRANT for every PSA RPC. The pattern is identical for
--    each function; we repeat per-function so the pg_dump output (and
--    future `DROP FUNCTION ... CASCADE`) keeps the explicit grants.
REVOKE ALL ON FUNCTION public.cn_psa_reserve_slots(date, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_reserve_slots(date, integer) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_acquire_lock(date, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_acquire_lock(date, uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_release_lock(date, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_release_lock(date, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_record_candidate_failure(bigint, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_record_candidate_failure(bigint, timestamptz, text) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_recompute_priority(text, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_recompute_priority(text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_writethrough_pokepop(text, date, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_writethrough_pokepop(text, date, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.cn_psa_pilot_reserve_attempt() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_pilot_reserve_attempt() TO service_role;

-- cn_psa_pilot_arm is the most sensitive: it can activate the pilot and
-- change its cap. Explicitly locked down; service_role may invoke
-- programmatically if ever needed. Operator can also invoke via
-- Supabase SQL Editor which runs as postgres (bypasses REVOKE).
REVOKE ALL ON FUNCTION public.cn_psa_pilot_arm(integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cn_psa_pilot_arm(integer, boolean, text) TO service_role;

COMMIT;
