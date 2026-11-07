-- CN-DISCORD-01 · PR #1 — role-sync schema (dry-run only).
--
-- Adds three tables and one view that let the Hub role-sync cron
-- reconcile Collector Network memberships onto Discord roles.
-- No table is readable by anon or authenticated — these are
-- operational artefacts owned by the service_role worker.
--
-- The migration is strictly additive and does NOT touch
-- collector_memberships / collector_discord_links (CN-IDENTITY-01)
-- or cn_stock_* (CN-STOCK-02). The reconciliation view is the only
-- object that references CN-IDENTITY-01 and it is read-only.
--
-- Activation is OFF by default: collector_discord_guild_config has
-- role_sync_enabled=false seeded. The cron falls back to dry-run
-- mode regardless, until the operator explicitly flips the flag
-- AND populates collector_discord_role_bindings.

-- ─────────────────── bindings: tier → role id ───────────────────

create table if not exists public.collector_discord_role_bindings (
  tier             text primary key check (tier in ('free','premium')),
  discord_role_id  text not null,
  label            text,
  updated_at       timestamptz not null default now()
);

comment on table public.collector_discord_role_bindings is
  'CN-DISCORD-01 · maps Collector Network membership tiers onto Discord guild roles. One row per tier. Seeded manually by the operator after the Discord bot is wired.';

alter table public.collector_discord_role_bindings enable row level security;
-- No policies → with RLS enabled, non-service_role callers see zero rows.
-- Writes are service_role-only by virtue of the deny-by-default stance.

-- ─────────────────── guild config singleton ───────────────────

create table if not exists public.collector_discord_guild_config (
  id                  int primary key default 1 check (id = 1),
  guild_id            text,
  role_sync_enabled   boolean not null default false,
  last_sync_at        timestamptz,
  last_sync_summary   jsonb,
  updated_at          timestamptz not null default now()
);
insert into public.collector_discord_guild_config (id)
  values (1) on conflict (id) do nothing;

comment on table public.collector_discord_guild_config is
  'CN-DISCORD-01 · singleton config row holding the target Discord guild id and the role_sync_enabled flag. role_sync_enabled MUST remain false until the operator has verified a dry-run.';

alter table public.collector_discord_guild_config enable row level security;
-- No policies: service_role only.

-- ─────────────────── audit log ───────────────────

create table if not exists public.collector_discord_role_sync_log (
  id                 bigserial primary key,
  run_id             uuid not null,
  user_id            uuid,
  discord_user_id    text,
  desired_tier       text,
  desired_role_id    text,
  previous_role_ids  text[],
  action             text not null check (action in (
    'add_role',
    'remove_role',
    'noop',
    'skip_not_in_guild',
    'skip_disconnected',
    'skip_no_binding',
    'skip_suspended',
    'skip_no_guild_config'
  )),
  result             text not null check (result in (
    'dry_run',
    'ok',
    'error_429',
    'error_403',
    'error_404',
    'error_other'
  )),
  error_detail       text,
  created_at         timestamptz not null default now()
);

create index if not exists collector_discord_role_sync_log_run_id_idx
  on public.collector_discord_role_sync_log (run_id);
create index if not exists collector_discord_role_sync_log_user_idx
  on public.collector_discord_role_sync_log (user_id, created_at desc);

comment on table public.collector_discord_role_sync_log is
  'CN-DISCORD-01 · one row per planned / applied / skipped role action. Includes dry-run rows so the operator can inspect what WOULD change before flipping role_sync_enabled.';

alter table public.collector_discord_role_sync_log enable row level security;
-- No policies: service_role only.

-- ─────────────────── reconciliation view ───────────────────
--
-- Combines a user's membership summary with their discord link so
-- the reconciliation engine has a single query to iterate. Users
-- without a discord_user_id are included so the engine can log
-- them as skip_disconnected (makes dry-run audits complete).

create or replace view public.collector_discord_role_sync_targets as
select
  m.user_id,
  m.tier                                         as current_tier,
  m.status                                       as current_status,
  m.expires_at                                   as current_expires_at,
  dl.discord_user_id                             as discord_user_id,
  dl.disconnected_at is null and dl.discord_user_id is not null
                                                 as discord_active,
  -- "desired tier" is what the role sync should push to Discord
  -- RIGHT NOW. Expired premium degrades to free. Suspended /
  -- cancelled membership gets no role (handled in app code).
  case
    when m.status != 'active' then null
    when m.tier = 'premium' and m.expires_at is not null and m.expires_at < now() then 'free'
    else m.tier
  end                                            as desired_tier
from public.collector_memberships m
left join public.collector_discord_links dl
  on dl.user_id = m.user_id
 and dl.disconnected_at is null;

comment on view public.collector_discord_role_sync_targets is
  'CN-DISCORD-01 · reconciliation input. For every collector_memberships row, emits the user_id, their active Discord link (if any), and the tier the role sync should enforce right now. Suspended / cancelled users get desired_tier = NULL and the engine removes both roles. Expired premium degrades to free in-view.';

-- Make it readable by service_role only (views inherit no RLS; we
-- revoke from PUBLIC so anon / authenticated cannot touch it).
revoke all on public.collector_discord_role_sync_targets from public;
grant select on public.collector_discord_role_sync_targets to service_role;

-- Same lockdown on the three tables (RLS already denies, but a
-- missing GRANT is belt-and-braces against future mistakes).
revoke all on public.collector_discord_role_bindings    from public;
revoke all on public.collector_discord_guild_config     from public;
revoke all on public.collector_discord_role_sync_log    from public;
grant select, insert, update, delete on public.collector_discord_role_bindings    to service_role;
grant select, insert, update          on public.collector_discord_guild_config    to service_role;
grant select, insert                  on public.collector_discord_role_sync_log   to service_role;
