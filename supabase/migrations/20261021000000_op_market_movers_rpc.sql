-- CN-COST-03 / CN-MARKET-FIX
-- OnePiecePrices /market: cache-only RPC + refresh job.
--
-- Repairs the public-facing HTTP 500 on /market caused by streaming
-- 190k–270k rows per 30-day window through PostgREST.
--
-- Objects created:
--   1. public.op_market_movers_cache   — one row per (window_days,
--      currency), rebuilt by the refresh function.
--   2. public.op_market_movers_refresh() — SECURITY DEFINER; called
--      by the tcggraph-refresh cron after a successful one-piece
--      ingestion. EXECUTE restricted to service_role.
--   3. public.op_market_movers(...)    — SECURITY INVOKER; the
--      application reads this. Cache-only; raises when no snapshot
--      exists rather than fabricating an empty result.
--
-- Rollback at the bottom of this file.

-- ================================================================
-- 1. CACHE TABLE + RLS + PERMISSIONS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.op_market_movers_cache (
  window_days  int         NOT NULL CHECK (window_days IN (7, 30, 90)),
  currency     text        NOT NULL DEFAULT ''
    CHECK (currency IN ('', 'EUR', 'USD')),
  computed_at  timestamptz NOT NULL DEFAULT now(),
  row_count    int         NOT NULL CHECK (row_count > 0),
  payload      jsonb       NOT NULL,
  CONSTRAINT op_market_movers_cache_pkey PRIMARY KEY (window_days, currency)
);

COMMENT ON TABLE public.op_market_movers_cache IS
  'Precomputed top-N risers + fallers per (window_days, currency) for OPP /market. Refreshed by op_market_movers_refresh() after each successful tcggraph one-piece ingestion. Read-only to anon/authenticated via RLS SELECT policy.';

ALTER TABLE public.op_market_movers_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.op_market_movers_cache FROM PUBLIC;
REVOKE ALL ON TABLE public.op_market_movers_cache FROM anon;
REVOKE ALL ON TABLE public.op_market_movers_cache FROM authenticated;
GRANT  SELECT ON TABLE public.op_market_movers_cache TO anon, authenticated;

DROP POLICY IF EXISTS op_market_movers_cache_public_read
  ON public.op_market_movers_cache;
CREATE POLICY op_market_movers_cache_public_read
  ON public.op_market_movers_cache
  FOR SELECT TO anon, authenticated
  USING (true);

-- ================================================================
-- 2. REFRESH FUNCTION  (service_role / cron only, SECURITY DEFINER)
--
-- Three scans (7, 30, 90 days). Each scan computes first/last/count
-- per (printing, currency) group with deterministic tie-breakers,
-- then derives three cache variants (all, EUR, USD) from the shared
-- aggregation. Nine cache rows upserted total.
--
-- OUT variables are prefixed `out_` to avoid any name collision
-- with cache table columns inside the function body. Every column
-- reference in CTEs is table/CTE-qualified. ON CONFLICT names the
-- constraint explicitly.
--
-- Writes guarded by `WHERE a.n > 0` so a failed or signal-less
-- window cannot overwrite a previously-good snapshot.
-- ================================================================
CREATE OR REPLACE FUNCTION public.op_market_movers_refresh()
RETURNS TABLE (
  out_window_days  int,
  out_currency     text,
  out_row_count    int,
  out_computed_at  timestamptz,
  elapsed_ms       int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path    = public, pg_temp
-- Three table scans at measured 7078/3117/3326 ms (CN-COST-03
-- verification). PostgREST's default per-request statement timeout
-- is 8 s on anon/authenticated/service_role; the refresh exceeds
-- that in aggregate. Scoping the timeout to this function only
-- (via SET) keeps global PostgREST limits intact for every other
-- RPC. 60 s gives generous headroom for data growth without opening
-- a general escape hatch.
SET statement_timeout = '60s'
AS $$
DECLARE
  v_window     int;
  v_start      timestamptz;
  v_cache_row  RECORD;
BEGIN
  FOREACH v_window IN ARRAY ARRAY[7, 30, 90] LOOP
    v_start := clock_timestamp();

    WITH per_group AS (
      SELECT
        d.tcg_printing_id,
        upper(coalesce(d.currency, 'USD')) AS cur,
        (array_agg(d.price ORDER BY d.observed_on ASC,  d.source ASC,  d.list_type ASC,  d.finish ASC,  d.source_run_id::text ASC))[1]  AS first_price,
        (array_agg(d.price ORDER BY d.observed_on DESC, d.source DESC, d.list_type DESC, d.finish DESC, d.source_run_id::text DESC))[1] AS last_price,
        count(*)::int AS observation_count
      FROM public.tcg_market_price_daily AS d
      WHERE d.game_id = 'onepiece'
        AND d.observed_on >= (CURRENT_DATE - v_window)
        AND d.price IS NOT NULL
      GROUP BY d.tcg_printing_id, upper(coalesce(d.currency, 'USD'))
    ),
    moved AS (
      SELECT g.tcg_printing_id,
             g.cur AS group_currency,
             g.first_price,
             g.last_price,
             g.observation_count,
             (g.last_price - g.first_price) / g.first_price AS change_pct
      FROM per_group AS g
      WHERE g.observation_count >= 3
        AND g.last_price      >= 2
        AND g.last_price      <= 50000
        AND g.first_price     >  0
    ),
    variant_params(cur_key, cur_filter) AS (
      VALUES (''::text, NULL::text),
             ('EUR'::text, 'EUR'::text),
             ('USD'::text, 'USD'::text)
    ),
    picks AS (
      SELECT vp.cur_key,
             'riser'::text AS direction,
             m.tcg_printing_id,
             m.group_currency,
             m.first_price,
             m.last_price,
             m.observation_count,
             m.change_pct,
             row_number() OVER (
               PARTITION BY vp.cur_key
               ORDER BY m.change_pct DESC,
                        m.tcg_printing_id ASC,
                        m.group_currency ASC
             ) AS rn
      FROM variant_params AS vp, moved AS m
      WHERE m.change_pct > 0
        AND abs(m.change_pct) <= 20
        AND (vp.cur_filter IS NULL OR m.group_currency = vp.cur_filter)
      UNION ALL
      SELECT vp.cur_key,
             'faller'::text AS direction,
             m.tcg_printing_id,
             m.group_currency,
             m.first_price,
             m.last_price,
             m.observation_count,
             m.change_pct,
             row_number() OVER (
               PARTITION BY vp.cur_key
               ORDER BY m.change_pct ASC,
                        m.tcg_printing_id ASC,
                        m.group_currency ASC
             ) AS rn
      FROM variant_params AS vp, moved AS m
      WHERE m.change_pct < 0
        AND abs(m.change_pct) <= 20
        AND (vp.cur_filter IS NULL OR m.group_currency = vp.cur_filter)
    ),
    top_n AS (
      SELECT p.cur_key,
             p.direction,
             p.tcg_printing_id,
             p.group_currency AS mover_currency,
             p.first_price,
             p.last_price,
             p.observation_count,
             p.change_pct
      FROM picks AS p
      WHERE p.rn <= 30
    ),
    agg AS (
      SELECT t.cur_key,
             count(*)::int AS n,
             jsonb_agg(
               jsonb_build_object(
                 'direction',         t.direction,
                 'tcg_printing_id',   t.tcg_printing_id,
                 'currency',          t.mover_currency,
                 'first_price',       t.first_price,
                 'last_price',        t.last_price,
                 'observation_count', t.observation_count,
                 'change_pct',        t.change_pct
               )
               ORDER BY t.direction, t.tcg_printing_id, t.mover_currency
             ) AS payload
      FROM top_n AS t
      GROUP BY t.cur_key
    )
    INSERT INTO public.op_market_movers_cache AS c
      (window_days, currency, computed_at, row_count, payload)
    SELECT v_window, a.cur_key, now(), a.n, a.payload
    FROM agg AS a
    WHERE a.n > 0
    ON CONFLICT ON CONSTRAINT op_market_movers_cache_pkey DO UPDATE SET
      computed_at = EXCLUDED.computed_at,
      row_count   = EXCLUDED.row_count,
      payload     = EXCLUDED.payload;

    -- Emit observed cache rows for this window.
    FOR v_cache_row IN
      SELECT c.currency    AS cur,
             c.row_count   AS n,
             c.computed_at AS ts
      FROM public.op_market_movers_cache AS c
      WHERE c.window_days = v_window
    LOOP
      out_window_days := v_window;
      out_currency    := v_cache_row.cur;
      out_row_count   := v_cache_row.n;
      out_computed_at := v_cache_row.ts;
      elapsed_ms      := (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.op_market_movers_refresh() IS
  'Rebuilds public.op_market_movers_cache for all 9 (window × currency) combinations in three scans of tcg_market_price_daily. Never writes empty rows — a previously-good snapshot survives a bad refresh. Returns per-window timings.';

REVOKE EXECUTE ON FUNCTION public.op_market_movers_refresh() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.op_market_movers_refresh() FROM anon;
REVOKE EXECUTE ON FUNCTION public.op_market_movers_refresh() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.op_market_movers_refresh() TO service_role;

-- ================================================================
-- 3. PUBLIC RPC  (cache-only, SECURITY INVOKER as anon)
--
-- Serves only from op_market_movers_cache. If no snapshot exists
-- for the requested (window_days, currency) combination, raises
-- so the application returns an honest 500 rather than fabricating
-- an empty 200. Returns computed_at per row so the page can
-- display freshness.
-- ================================================================
CREATE OR REPLACE FUNCTION public.op_market_movers(
  p_window_days  int,
  p_currency     text DEFAULT NULL
)
RETURNS TABLE (
  direction          text,
  tcg_printing_id    text,
  currency           text,
  first_price        numeric,
  last_price         numeric,
  observation_count  int,
  change_pct         numeric,
  computed_at        timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cur_filter text;
  v_payload    jsonb;
  v_at         timestamptz;
BEGIN
  IF p_window_days IS NULL OR p_window_days NOT IN (7, 30, 90) THEN
    RAISE EXCEPTION 'op_market_movers: p_window_days must be 7, 30 or 90 (got %)', p_window_days
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_currency IS NOT NULL AND upper(p_currency) NOT IN ('EUR', 'USD') THEN
    RAISE EXCEPTION 'op_market_movers: p_currency must be EUR, USD or NULL (got %)', p_currency
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_cur_filter := coalesce(upper(p_currency), '');

  SELECT c.payload, c.computed_at
    INTO v_payload, v_at
  FROM public.op_market_movers_cache AS c
  WHERE c.window_days = p_window_days
    AND c.currency    = v_cur_filter;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'op_market_movers: no snapshot yet for window=% currency=% — refresh job has not completed', p_window_days, coalesce(p_currency, 'all')
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN QUERY
  SELECT r.direction,
         r.tcg_printing_id,
         r.currency,
         r.first_price,
         r.last_price,
         r.observation_count,
         r.change_pct,
         v_at AS computed_at
  FROM jsonb_to_recordset(v_payload) AS r(
    direction          text,
    tcg_printing_id    text,
    currency           text,
    first_price        numeric,
    last_price         numeric,
    observation_count  int,
    change_pct         numeric
  );
END;
$$;

COMMENT ON FUNCTION public.op_market_movers(int, text) IS
  'Cache-only read of top-30 risers + top-30 fallers for OnePiecePrices. Serves the last successfully-computed snapshot with its computed_at. Raises when no snapshot exists for the requested (window, currency) — never fabricates an empty result.';

REVOKE EXECUTE ON FUNCTION public.op_market_movers(int, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.op_market_movers(int, text) TO anon, authenticated;

-- ================================================================
-- ROLLBACK (reverse order)
-- ================================================================
--   DROP FUNCTION IF EXISTS public.op_market_movers(int, text);
--   DROP FUNCTION IF EXISTS public.op_market_movers_refresh();
--   DROP POLICY   IF EXISTS op_market_movers_cache_public_read
--     ON public.op_market_movers_cache;
--   DROP TABLE    IF EXISTS public.op_market_movers_cache;
