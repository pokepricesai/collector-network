-- CN-IDENTITY-01 · pre-merge security corrections
--
-- Two issues flagged on review of the first migration
-- (20261107070000_cn_identity_01_memberships_discord.sql):
--
--   1. collector_link_discord / collector_unlink_discord accepted an
--      explicit p_user_id parameter AND were granted to `authenticated`.
--      Combined with SECURITY DEFINER, this would have let any logged-
--      in user overwrite ANOTHER user's Discord link by passing the
--      victim's user_id. REMEDIATION: drop the parameter; the function
--      reads auth.uid() internally. A separate collector_admin_*
--      helper restricted to service_role carries the operator path.
--
--   2. Verify + harden the original access-control on
--      collector_set_membership_tier so an ordinary authenticated user
--      cannot escalate to Premium. REMEDIATION: re-issue the REVOKE /
--      GRANT ladder defensively; add an explicit check inside the
--      function body so even if a future migration re-grants EXECUTE
--      by mistake, the function refuses to run for any non-service
--      caller.
--
-- Also added defence-in-depth on collector_user_has_feature so one
-- user cannot probe another user's premium status via the RPC.
--
-- Idempotent. Safe to re-run.

-- ──────── Drop old self-service signatures (keep admin signatures) ────────

drop function if exists public.collector_link_discord(uuid, text, text, text, text);
drop function if exists public.collector_unlink_discord(uuid);

-- ──────── Self-service: link Discord to the CALLING user only ────────

create or replace function public.collector_link_discord(
  p_discord_user_id text,
  p_username        text default null,
  p_avatar          text default null,
  p_email           text default null
) returns public.collector_discord_links
language plpgsql
security definer
set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
  row public.collector_discord_links;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  insert into public.collector_discord_links
    (user_id, discord_user_id, discord_username, discord_avatar,
     discord_email, linked_at, verified_at, disconnected_at)
  values
    (v_user_id, p_discord_user_id, p_username, p_avatar, p_email,
     now(), now(), null)
  on conflict (user_id) do update
    set discord_user_id = excluded.discord_user_id,
        discord_username = excluded.discord_username,
        discord_avatar = excluded.discord_avatar,
        discord_email = excluded.discord_email,
        linked_at = now(),
        verified_at = now(),
        disconnected_at = null
  returning * into row;
  return row;
exception
  when unique_violation then
    raise exception
      'discord_already_linked: Discord user % is linked to another Collector Network account',
      p_discord_user_id
      using errcode = 'P0001';
end;
$$;

create or replace function public.collector_unlink_discord()
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  update public.collector_discord_links
    set disconnected_at = now(),
        verified_at = null
    where user_id = v_user_id;
end;
$$;

-- ──────── Admin / operator variants (service_role only) ────────

create or replace function public.collector_admin_link_discord(
  p_user_id         uuid,
  p_discord_user_id text,
  p_username        text default null,
  p_avatar          text default null,
  p_email           text default null
) returns public.collector_discord_links
language plpgsql
security definer
set search_path = public as $$
declare
  row public.collector_discord_links;
begin
  insert into public.collector_discord_links
    (user_id, discord_user_id, discord_username, discord_avatar,
     discord_email, linked_at, verified_at, disconnected_at)
  values
    (p_user_id, p_discord_user_id, p_username, p_avatar, p_email,
     now(), now(), null)
  on conflict (user_id) do update
    set discord_user_id = excluded.discord_user_id,
        discord_username = excluded.discord_username,
        discord_avatar = excluded.discord_avatar,
        discord_email = excluded.discord_email,
        linked_at = now(),
        verified_at = now(),
        disconnected_at = null
  returning * into row;
  return row;
exception
  when unique_violation then
    raise exception
      'discord_already_linked: Discord user % is linked to another Collector Network account',
      p_discord_user_id
      using errcode = 'P0001';
end;
$$;

create or replace function public.collector_admin_unlink_discord(
  p_user_id uuid
) returns void
language sql
security definer
set search_path = public as $$
  update public.collector_discord_links
    set disconnected_at = now(),
        verified_at = null
    where user_id = p_user_id;
$$;

-- ──────── Harden collector_set_membership_tier ────────
--
-- Re-issue the function with an explicit internal check that refuses
-- to upgrade any user unless the caller is service_role (i.e. the
-- Hub / billing worker / operator). This belt-and-braces — even if
-- a future migration accidentally re-grants EXECUTE to authenticated,
-- the function body refuses the call.

create or replace function public.collector_set_membership_tier(
  p_user_id       uuid,
  p_tier          text,
  p_expires_at    timestamptz default null,
  p_source        text default 'operator',
  p_notes         text default null
) returns public.collector_memberships
language plpgsql
security definer
set search_path = public as $$
declare
  row public.collector_memberships;
begin
  -- Defence-in-depth: this function must ONLY be callable by the
  -- service_role (Hub admin / billing worker). An ordinary user
  -- session has auth.uid() non-null; service_role sessions set
  -- request.jwt.claims role = 'service_role' and auth.uid() is
  -- null-or-undefined. We check both signals to avoid relying on
  -- EXECUTE privileges alone.
  if current_setting('request.jwt.claims', true) is not null
     and (current_setting('request.jwt.claims', true)::jsonb ->> 'role') <> 'service_role'
  then
    raise exception 'forbidden: collector_set_membership_tier is service_role only'
      using errcode = 'P0001';
  end if;
  if p_tier not in ('free','premium') then
    raise exception 'invalid tier: %', p_tier using errcode = 'P0001';
  end if;
  insert into public.collector_memberships
    (user_id, tier, status, activated_at, expires_at, source, notes)
  values
    (p_user_id, p_tier, 'active', now(), p_expires_at, p_source, p_notes)
  on conflict (user_id) do update
    set tier = excluded.tier,
        status = 'active',
        activated_at = case when public.collector_memberships.tier <> excluded.tier
                            then now()
                            else public.collector_memberships.activated_at end,
        expires_at = excluded.expires_at,
        source = excluded.source,
        notes = coalesce(excluded.notes, public.collector_memberships.notes)
  returning * into row;
  return row;
end;
$$;

-- ──────── Harden collector_user_has_feature ────────
--
-- Defence-in-depth: the function already runs SECURITY DEFINER so
-- the SELECT bypasses RLS. Prevent one authenticated user from
-- probing another user's membership tier by rejecting the call
-- when auth.uid() exists and differs from p_user_id.

create or replace function public.collector_user_has_feature(
  p_user_id uuid,
  p_feature text
) returns boolean
language plpgsql
stable
security definer
set search_path = public as $$
declare
  v_caller uuid := auth.uid();
  v_tier text;
  v_status text;
  v_expires timestamptz;
begin
  if p_user_id is null then
    return false;
  end if;
  -- Cross-user probe guard: service_role sessions have v_caller IS
  -- NULL and bypass this check (so the stock-alert worker can
  -- answer "does subscriber X have premium?" when planning
  -- delivery targets). Authenticated users may only check their
  -- own features.
  if v_caller is not null and v_caller <> p_user_id then
    return false;
  end if;
  select tier, status, expires_at
    into v_tier, v_status, v_expires
    from public.collector_memberships
    where user_id = p_user_id
    limit 1;
  if not found then
    return false;
  end if;
  if v_status <> 'active' then
    return false;
  end if;
  if v_expires is not null and v_expires < now() then
    return p_feature in ('stock_alerts_free', 'ebay_deals_free');
  end if;
  if v_tier = 'premium' then
    return p_feature in ('stock_alerts_free','ebay_deals_free','stock_alerts_premium','ebay_deals_premium');
  end if;
  if v_tier = 'free' then
    return p_feature in ('stock_alerts_free', 'ebay_deals_free');
  end if;
  return false;
end;
$$;

-- ──────── Re-issue EXECUTE grants defensively ────────

-- Self-service: authenticated callers only.
revoke all on function public.collector_link_discord(text, text, text, text) from public, anon;
grant execute on function public.collector_link_discord(text, text, text, text) to authenticated, service_role;
revoke all on function public.collector_unlink_discord() from public, anon;
grant execute on function public.collector_unlink_discord() to authenticated, service_role;

-- Admin: service_role only.
revoke all on function public.collector_admin_link_discord(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.collector_admin_link_discord(uuid, text, text, text, text) to service_role;
revoke all on function public.collector_admin_unlink_discord(uuid) from public, anon, authenticated;
grant execute on function public.collector_admin_unlink_discord(uuid) to service_role;

-- Tier mutation: service_role only, double-guarded by the internal
-- JWT role check above.
revoke all on function public.collector_set_membership_tier(uuid, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.collector_set_membership_tier(uuid, text, timestamptz, text, text) to service_role;

-- Feature check: authenticated callers (self only, enforced in body).
revoke all on function public.collector_user_has_feature(uuid, text) from public;
grant execute on function public.collector_user_has_feature(uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
