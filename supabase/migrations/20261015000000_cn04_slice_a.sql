-- =============================================================
-- CN-04 Slice A · Editorial approval workflow + $1 / 7-day budget
-- =============================================================
--
-- Three focused changes:
--
--   1. Extend network_idea_status with 'approved' (and 'rejected'
--      for symmetry; dismissed stays as the terminal 'not now'
--      status). Only approved ideas become eligible for AI drafting.
--
--   2. Seed a new rolling_7d_budget_usd config key at $1.00. This
--      is the HARD ceiling for all article-related AI spend across
--      a trailing 168-hour window.
--
--   3. Add network_reserve_rolling_ai_budget — a concurrency-safe
--      sibling of network_reserve_ai_budget that enforces the
--      7-day rolling cap. Reservation + consume + release/fail
--      still use the existing shared RPCs on the same reservations
--      table.

-- --- 1. Idea status enum additions --------------------------------

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'network_idea_status' and e.enumlabel = 'approved'
  ) then
    alter type public.network_idea_status add value 'approved';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'network_idea_status' and e.enumlabel = 'rejected'
  ) then
    alter type public.network_idea_status add value 'rejected';
  end if;
end $$;

-- Track who approved an idea and when; distinct from dismiss which
-- was an outright "no". Both columns are nullable because they only
-- populate on transition.
alter table public.network_content_ideas
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references public.network_admin_users (id) on delete set null;

-- No partial index needed: network_content_ideas_site_status_idx
-- (site_id, status, priority) from phase3 already covers queries
-- filtering by status='approved'. A partial index referencing a
-- freshly-added enum value fails inside the same transaction
-- (PG 55P04), so we lean on the existing composite instead.

-- --- 2. Rolling 7-day budget config -------------------------------

insert into public.network_autopilot_config (scope, key, value, description) values
  ('global', 'rolling_7d_budget_usd', '1.00'::jsonb,
    'Hard rolling 168-hour budget ceiling (USD) across every article-related AI operation. Enforced by network_reserve_rolling_ai_budget.')
on conflict (scope, key) do nothing;

-- --- 3. Rolling-7d reservation RPC --------------------------------
--
-- Takes an advisory lock so concurrent reservations cannot both
-- read the same remaining budget. Counts actual spend from
-- network_ai_cost_log (ground truth) plus still-outstanding
-- reservations on network_ai_budget_reservations.

create or replace function public.network_reserve_rolling_ai_budget(
  p_estimated_usd numeric,
  p_idea_id       uuid,
  p_site_id       uuid
)
returns table(reservation_id uuid, reserved boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key  bigint := hashtextextended('network_rolling_budget', 0);
  v_limit     numeric;
  v_spent     numeric;
  v_reserved  numeric;
  v_new_id    uuid;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  if p_estimated_usd is null or p_estimated_usd < 0 then
    return query select null::uuid, false, 'invalid_estimate';
    return;
  end if;

  select (value #>> '{}')::numeric into v_limit
    from public.network_autopilot_config
   where scope = 'global' and key = 'rolling_7d_budget_usd';
  if v_limit is null then v_limit := 1.00; end if;

  -- Actual spend from cost log over trailing 7 days. logAiCost is
  -- called after a successful AI call and after the matching
  -- reservation has been consumed, so there is no double counting
  -- between these two sources.
  select coalesce(sum(est_cost_usd), 0) into v_spent
    from public.network_ai_cost_log
   where created_at >= now() - interval '7 days';

  -- Outstanding (not yet consumed/released) reservations younger
  -- than 7 days.
  select coalesce(sum(estimated_cost_usd), 0) into v_reserved
    from public.network_ai_budget_reservations
   where status = 'reserved'
     and created_at >= now() - interval '7 days';

  if v_spent + v_reserved + p_estimated_usd > v_limit then
    return query select null::uuid, false, 'rolling_budget_exceeded';
    return;
  end if;

  insert into public.network_ai_budget_reservations
    (site_id, idea_id, estimated_cost_usd, status)
    values (p_site_id, p_idea_id, p_estimated_usd, 'reserved')
    returning id into v_new_id;

  return query select v_new_id, true, null::text;
end $$;

revoke all on function public.network_reserve_rolling_ai_budget(numeric, uuid, uuid) from public;
grant execute on function public.network_reserve_rolling_ai_budget(numeric, uuid, uuid)
  to authenticated, service_role;

comment on function public.network_reserve_rolling_ai_budget(numeric, uuid, uuid)
  is 'CN-04 Slice A: atomic rolling-7d AI budget reservation. Pairs with network_consume_ai_budget / network_release_ai_budget / network_fail_ai_budget.';
