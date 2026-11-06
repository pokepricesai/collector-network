-- CN-IDENTITY-01 · network-wide memberships + Discord account linking
--
-- Extends the existing Collector Network shared-auth stack. Does NOT
-- rebuild auth: keeps auth.users as the canonical identity store,
-- reuses the collector_* naming convention from CN-A (collector_sites,
-- collector_user_sites, collector_marketing_preferences).
--
-- Two new tables:
--
--   collector_memberships    one row per auth.users user, carrying
--                             the network-wide entitlement tier.
--                             Every new signup gets a 'free' row by
--                             trigger; operator upgrades to 'premium'
--                             by direct SQL until the billing layer
--                             (CN-BILLING, future) is ready.
--
--   collector_discord_links  one row per linked Discord identity.
--                             UNIQUE on discord_user_id prevents
--                             multiple Collector Network accounts
--                             from claiming the same Discord user.
--                             Independent of Supabase Auth's
--                             auth.identities so we can carry our
--                             own metadata (verified_at, operator
--                             notes) + control the uniqueness
--                             invariant at the application layer.
--
-- Entitlement semantics (see collector_user_has_feature):
--
--   free  ·  stock_alerts_free, ebay_deals_free
--   premium  ·  free features + stock_alerts_premium, ebay_deals_premium
--
-- Discord linking NEVER grants premium. Premium is a separate flip
-- on collector_memberships.tier.

-- ─────────────────── collector_memberships ──────────────────────

create table if not exists public.collector_memberships (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  tier            text not null default 'free'
                  check (tier in ('free', 'premium')),
  status          text not null default 'active'
                  check (status in ('active', 'cancelled', 'expired', 'suspended')),
  activated_at    timestamptz not null default now(),
  expires_at      timestamptz,
  source          text default 'signup'
                  check (source in ('signup', 'operator', 'trial', 'gift', 'billing')),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists collector_memberships_tier_status_idx
  on public.collector_memberships (tier, status);

create or replace function public.collector_memberships_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists collector_memberships_touch on public.collector_memberships;
create trigger collector_memberships_touch
  before update on public.collector_memberships
  for each row execute function public.collector_memberships_touch_updated_at();

-- ─────────── Auto-provision free row on new signup ──────────────
--
-- Fires AFTER INSERT on auth.users. Mirrors the collector_user_sites
-- auto-provision pattern already used elsewhere in CN-A.

create or replace function public.collector_memberships_bootstrap()
returns trigger language plpgsql
security definer set search_path = public as $$
begin
  insert into public.collector_memberships (user_id, tier, status, source)
  values (new.id, 'free', 'active', 'signup')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists collector_memberships_bootstrap_trigger on auth.users;
create trigger collector_memberships_bootstrap_trigger
  after insert on auth.users
  for each row execute function public.collector_memberships_bootstrap();

-- Backfill: give existing users a 'free' row so entitlement checks
-- don't return null for them.
insert into public.collector_memberships (user_id, tier, status, source)
select u.id, 'free', 'active', 'signup'
  from auth.users u
  left join public.collector_memberships m on m.user_id = u.id
 where m.user_id is null;

-- ─────────────────── collector_discord_links ────────────────────

create table if not exists public.collector_discord_links (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  discord_user_id     text not null,
  discord_username    text,
  discord_avatar      text,
  discord_email       text,
  linked_at           timestamptz not null default now(),
  verified_at         timestamptz,
  disconnected_at     timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint collector_discord_links_user_unique unique (user_id),
  constraint collector_discord_links_discord_unique unique (discord_user_id)
);

create index if not exists collector_discord_links_discord_idx
  on public.collector_discord_links (discord_user_id);

drop trigger if exists collector_discord_links_touch on public.collector_discord_links;
create trigger collector_discord_links_touch
  before update on public.collector_discord_links
  for each row execute function public.collector_memberships_touch_updated_at();

-- ─────────────────── Entitlement helper ────────────────────────
--
-- Single stable server-callable function. Every Collector Network
-- site + the future stock-alert-delivery worker calls THIS to gate
-- a feature; no site-side hard-coding of tiers.

create or replace function public.collector_user_has_feature(
  p_user_id uuid,
  p_feature text
) returns boolean
language sql
stable
security definer
set search_path = public as $$
  with m as (
    select tier, status, expires_at
      from public.collector_memberships
      where user_id = p_user_id
      limit 1
  )
  select case
    -- Anonymous / unknown user → false
    when p_user_id is null then false
    when not exists (select 1 from m) then false
    -- Inactive membership: no features
    when (select status from m) <> 'active' then false
    -- Expired premium falls back to free (expired is set by billing
    -- worker / operator; we double-check the expires_at timestamp here)
    when (select expires_at from m) is not null
      and (select expires_at from m) < now() then
        p_feature in ('stock_alerts_free', 'ebay_deals_free')
    -- Premium: all features
    when (select tier from m) = 'premium' then
        p_feature in ('stock_alerts_free','ebay_deals_free','stock_alerts_premium','ebay_deals_premium')
    -- Free tier: free features only
    when (select tier from m) = 'free' then
        p_feature in ('stock_alerts_free', 'ebay_deals_free')
    else false
  end;
$$;

-- Convenience view the sites can read via RLS.
create or replace view public.collector_user_membership_view
with (security_invoker = false, security_barrier = true)
as
  select
    m.user_id,
    m.tier,
    m.status,
    m.activated_at,
    m.expires_at,
    exists (
      select 1 from public.collector_discord_links d
       where d.user_id = m.user_id and d.disconnected_at is null
    ) as discord_linked
  from public.collector_memberships m;

-- ─────────────────── RLS ────────────────────────────────────────

alter table public.collector_memberships enable row level security;
alter table public.collector_discord_links enable row level security;

-- Users: read own row.
drop policy if exists collector_memberships_own_read on public.collector_memberships;
create policy collector_memberships_own_read
  on public.collector_memberships for select
  using (auth.uid() = user_id);

drop policy if exists collector_discord_links_own_read on public.collector_discord_links;
create policy collector_discord_links_own_read
  on public.collector_discord_links for select
  using (auth.uid() = user_id);

-- Users: insert / update their own Discord link (the link API routes
-- validate the Discord OAuth proof server-side; the RLS policy here
-- is defence-in-depth, not the primary gate).
drop policy if exists collector_discord_links_own_write on public.collector_discord_links;
create policy collector_discord_links_own_write
  on public.collector_discord_links for insert
  with check (auth.uid() = user_id);

drop policy if exists collector_discord_links_own_update on public.collector_discord_links;
create policy collector_discord_links_own_update
  on public.collector_discord_links for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Service-role (used by the Hub admin) and functions with SECURITY
-- DEFINER bypass RLS. Operator can set premium status via the
-- service_role credential or by writing admin pages that call the
-- membership RPCs below.

-- Admin RPC: set a user's membership tier. Service-role only (RLS).
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
  if p_tier not in ('free','premium') then
    raise exception 'invalid tier: %', p_tier;
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

-- Server-callable Discord-link helper. Called by the site's
-- /api/auth/discord-link/callback route AFTER Supabase Auth's
-- linkIdentity has returned the Discord provider identity. The
-- route extracts the Discord user_id from auth.identities and
-- passes it here.
create or replace function public.collector_link_discord(
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
    -- The UNIQUE (discord_user_id) constraint rejected the insert:
    -- this Discord identity is already linked to another CN user.
    raise exception
      'discord_already_linked: Discord user % is linked to another Collector Network account',
      p_discord_user_id
      using errcode = 'P0001';
end;
$$;

create or replace function public.collector_unlink_discord(
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

-- Grants: the collector_user_has_feature function needs to be
-- callable by both anon (for client-side preflight) AND authenticated.
-- The SECURITY DEFINER inside it reads the table safely.
revoke all on function public.collector_user_has_feature(uuid, text) from public;
grant execute on function public.collector_user_has_feature(uuid, text) to anon, authenticated, service_role;

revoke all on function public.collector_set_membership_tier(uuid, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.collector_set_membership_tier(uuid, text, timestamptz, text, text) to service_role;

revoke all on function public.collector_link_discord(uuid, text, text, text, text) from public, anon;
grant execute on function public.collector_link_discord(uuid, text, text, text, text) to authenticated, service_role;

revoke all on function public.collector_unlink_discord(uuid) from public, anon;
grant execute on function public.collector_unlink_discord(uuid) to authenticated, service_role;

revoke all on public.collector_user_membership_view from public, anon;
grant select on public.collector_user_membership_view to authenticated, service_role;

notify pgrst, 'reload schema';
