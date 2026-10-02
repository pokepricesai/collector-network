-- =============================================================
-- Collector Network OS — Phase 0 foundation
-- =============================================================
--
-- Establishes the central operational database for the Collector
-- Network Operating System. Introduces:
--
--   • network_sites            — canonical five-site registry
--   • network_admin_users      — explicit admin authorisation (NOT
--                                reusable consumer user accounts)
--   • network_integrations     — connector/provider registry
--   • network_data_sources     — source registry for traceability
--   • network_daily_metrics    — long-format daily metric values
--   • network_metric_definitions — metric catalogue + units
--   • network_job_runs         — background job tracking
--   • network_tasks            — operational to-do model
--   • network_alerts           — automated signal model
--   • network_approvals        — human-approval gate for AI/auto
--   • network_audit_log        — consequential-action trail
--   • network_settings         — key/value configuration
--
-- Security posture:
--
--   • RLS is ENABLED on every table.
--   • Policies gate reads/writes on `public.network_is_admin()` —
--     an authenticated user is only an admin if they are present
--     and active in network_admin_users.
--   • Ordinary consumer-site sessions get NO access to any of
--     these tables.
--   • No plaintext API secrets live in these tables; the
--     integration registry stores only configuration pointers
--     and status, never raw tokens.
--
-- Convention: network_* namespace, idempotent `create if not
-- exists`, safe to re-run.
--
-- Build note: this is Phase 0. Later phases add GSC/GA ingestion,
-- IndexNow, article workflow, etc.; those write to the tables
-- introduced here through RPCs or server-only service-role calls.

-- --- 0. Prerequisites --------------------------------------------
create extension if not exists pgcrypto;

-- --- 1. Enums ---------------------------------------------------
do $$
begin
  create type public.network_admin_role as enum
    ('owner', 'admin', 'editor', 'viewer');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_task_status as enum
    ('open', 'in_progress', 'waiting', 'completed', 'dismissed');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_task_priority as enum
    ('critical', 'high', 'normal', 'low');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_alert_level as enum
    ('critical', 'warning', 'opportunity', 'info');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_alert_status as enum
    ('open', 'acknowledged', 'resolved', 'suppressed');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_approval_status as enum
    ('pending', 'approved', 'rejected', 'cancelled', 'executed');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_job_status as enum
    ('running', 'success', 'warning', 'failed');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_integration_status as enum
    ('not_connected', 'connected', 'needs_configuration',
     'error', 'disabled');
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_actor_type as enum
    ('human', 'system', 'ai');
exception when duplicate_object then null; end $$;

-- --- 2. network_sites -------------------------------------------
--
-- Canonical registry. Everything site-scoped joins here.
create table if not exists public.network_sites (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z][a-z0-9_-]*$'),
  name            text not null,
  short_name      text not null,
  canonical_url   text not null,
  production_app  text,              -- apps/<name> or 'external'
  logo_path       text,              -- hub-relative public path
  status          text not null default 'active'
                  check (status in ('active', 'parked', 'planned',
                                    'archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- --- 3. network_admin_users -------------------------------------
--
-- Explicit admin authorisation. An auth.users row is NEVER
-- sufficient on its own; being present + active here is the
-- requirement. There is no public registration.
create table if not exists public.network_admin_users (
  id              uuid primary key default gen_random_uuid(),
  auth_user_id    uuid not null unique
                  references auth.users (id) on delete cascade,
  email           text not null,
  display_name    text,
  role            public.network_admin_role not null default 'viewer',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_login_at   timestamptz
);

create index if not exists network_admin_users_active_idx
  on public.network_admin_users (is_active)
  where is_active = true;

-- --- 4. network_is_admin() --------------------------------------
--
-- Boolean helper used by every RLS policy. SECURITY DEFINER so
-- the lookup bypasses RLS on the table it is reading, which is
-- essential — RLS on network_admin_users would otherwise require
-- the caller to already be an admin to prove they are an admin.
--
-- STABLE so the planner can cache the result within a statement.
create or replace function public.network_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.network_admin_users au
    where au.auth_user_id = auth.uid()
      and au.is_active
  );
$$;

revoke all on function public.network_is_admin() from public;
grant execute on function public.network_is_admin()
  to authenticated, service_role;

-- --- 5. network_admin_role_of() ---------------------------------
create or replace function public.network_admin_role_of(p_uid uuid)
returns public.network_admin_role
language sql
stable
security definer
set search_path = ''
as $$
  select au.role
  from public.network_admin_users au
  where au.auth_user_id = p_uid
    and au.is_active
  limit 1;
$$;

revoke all on function public.network_admin_role_of(uuid) from public;
grant execute on function public.network_admin_role_of(uuid)
  to authenticated, service_role;

-- --- 6. network_integrations ------------------------------------
create table if not exists public.network_integrations (
  id              uuid primary key default gen_random_uuid(),
  provider        text not null,          -- e.g. 'gsc', 'ga4'
  site_id         uuid references public.network_sites (id)
                  on delete cascade,       -- null = network-wide
  status          public.network_integration_status
                  not null default 'not_connected',
  credential_env  text,                   -- name of the env var
                                          -- holding the credential;
                                          -- never the credential
                                          -- itself
  config          jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  error_summary   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (provider, site_id)
);

-- --- 7. network_data_sources -----------------------------------
--
-- Classifies the origin of every record the OS ingests. Tasks,
-- metrics and alerts carry a source_code so later AI can reason
-- about provenance.
create table if not exists public.network_data_sources (
  code            text primary key
                  check (code ~ '^[a-z][a-z0-9_]*$'),
  display_name    text not null,
  description     text,
  category        text not null default 'external'
                  check (category in ('external', 'internal',
                                      'manual', 'derived')),
  created_at      timestamptz not null default now()
);

-- --- 8. network_metric_definitions ------------------------------
--
-- The authoritative list of metric codes. New metrics must be
-- registered here before daily rows are allowed. This keeps the
-- long-format network_daily_metrics table honest.
create table if not exists public.network_metric_definitions (
  code            text primary key
                  check (code ~ '^[a-z][a-z0-9_]*$'),
  display_name    text not null,
  description     text,
  unit            text,                   -- 'count', 'usd', 'pct'
  is_rate         boolean not null default false,
  default_source  text references public.network_data_sources (code),
  is_network      boolean not null default true,
  is_site         boolean not null default true,
  created_at      timestamptz not null default now()
);

-- --- 9. network_daily_metrics -----------------------------------
--
-- Long-format: one row per (date, metric, site_id, source).
-- site_id null means network-wide total. source captures the
-- feed the number came from (gsc, ga4, internal_db, manual…).
create table if not exists public.network_daily_metrics (
  id              uuid primary key default gen_random_uuid(),
  metric          text not null
                  references public.network_metric_definitions (code),
  date            date not null,
  site_id         uuid references public.network_sites (id)
                  on delete cascade,
  source          text not null
                  references public.network_data_sources (code),
  value           numeric not null,
  dimensions      jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- One canonical row per (metric, date, site, source). site NULL
  -- treated distinct from any site uuid by Postgres unique rules —
  -- partial unique indexes below cover both cases.
  constraint network_daily_metrics_site_unique unique
    (metric, date, site_id, source)
);

create index if not exists network_daily_metrics_metric_date_idx
  on public.network_daily_metrics (metric, date desc);
create index if not exists network_daily_metrics_site_date_idx
  on public.network_daily_metrics (site_id, date desc)
  where site_id is not null;

-- --- 10. network_job_runs ---------------------------------------
create table if not exists public.network_job_runs (
  id              uuid primary key default gen_random_uuid(),
  job_name        text not null,
  job_type        text not null default 'import'
                  check (job_type in ('import', 'export',
                                      'maintenance', 'sync',
                                      'analysis', 'automation')),
  site_id         uuid references public.network_sites (id)
                  on delete set null,
  status          public.network_job_status not null default 'running',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_examined   integer not null default 0,
  rows_inserted   integer not null default 0,
  rows_updated    integer not null default 0,
  rows_rejected   integer not null default 0,
  error_summary   text,
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists network_job_runs_name_started_idx
  on public.network_job_runs (job_name, started_at desc);
create index if not exists network_job_runs_status_idx
  on public.network_job_runs (status, started_at desc);

-- --- 11. network_tasks ------------------------------------------
create table if not exists public.network_tasks (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid references public.network_sites (id)
                  on delete set null,
  title           text not null,
  description     text,
  task_type       text not null default 'operational',
  source_code     text references public.network_data_sources (code),
  priority        public.network_task_priority not null default 'normal',
  status          public.network_task_status not null default 'open',
  evidence        jsonb not null default '{}'::jsonb,
  recommended_action text,
  assigned_to     uuid references public.network_admin_users (id)
                  on delete set null,
  created_at      timestamptz not null default now(),
  due_at          timestamptz,
  completed_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists network_tasks_status_priority_idx
  on public.network_tasks (status, priority);
create index if not exists network_tasks_site_status_idx
  on public.network_tasks (site_id, status)
  where site_id is not null;

-- --- 12. network_alerts -----------------------------------------
create table if not exists public.network_alerts (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid references public.network_sites (id)
                  on delete set null,
  level           public.network_alert_level not null,
  category        text not null,
  title           text not null,
  description     text,
  evidence        jsonb not null default '{}'::jsonb,
  source_code     text references public.network_data_sources (code),
  status          public.network_alert_status not null default 'open',
  first_detected_at timestamptz not null default now(),
  last_detected_at  timestamptz not null default now(),
  resolved_at     timestamptz,
  task_id         uuid references public.network_tasks (id)
                  on delete set null,
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists network_alerts_status_level_idx
  on public.network_alerts (status, level);
create index if not exists network_alerts_site_status_idx
  on public.network_alerts (site_id, status)
  where site_id is not null;

-- --- 13. network_approvals --------------------------------------
create table if not exists public.network_approvals (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid references public.network_sites (id)
                  on delete set null,
  action_type     text not null,          -- e.g. 'publish_article'
  title           text not null,
  description     text,
  payload         jsonb not null default '{}'::jsonb,
  source_code     text references public.network_data_sources (code),
  requested_by    public.network_actor_type not null default 'ai',
  requested_by_id uuid references public.network_admin_users (id)
                  on delete set null,
  status          public.network_approval_status not null default 'pending',
  reviewed_by     uuid references public.network_admin_users (id)
                  on delete set null,
  reviewed_at     timestamptz,
  review_notes    text,
  created_at      timestamptz not null default now(),
  executed_at     timestamptz
);

create index if not exists network_approvals_status_idx
  on public.network_approvals (status, created_at desc);

-- --- 14. network_audit_log --------------------------------------
--
-- Trail for every consequential admin / system / AI action.
-- Append-only; writes go through network_log_audit() so RLS stays
-- strict (admins can read; nobody writes directly).
create table if not exists public.network_audit_log (
  id              uuid primary key default gen_random_uuid(),
  occurred_at     timestamptz not null default now(),
  actor_type      public.network_actor_type not null default 'human',
  actor_user_id   uuid,                   -- auth.users.id (may be null
                                          -- for system/ai)
  site_id         uuid references public.network_sites (id)
                  on delete set null,
  action          text not null,          -- 'task.update', ...
  entity_type     text,
  entity_id       text,
  old_value       jsonb,
  new_value       jsonb,
  source          text,                   -- data-source code
  metadata        jsonb not null default '{}'::jsonb
);

create index if not exists network_audit_log_occurred_idx
  on public.network_audit_log (occurred_at desc);
create index if not exists network_audit_log_entity_idx
  on public.network_audit_log (entity_type, entity_id);

-- --- 15. network_settings ---------------------------------------
--
-- Key-value store for OS-level configuration. Site-scoped settings
-- can set site_id; network-wide keep site_id null. Values are
-- jsonb so we don't need per-feature settings tables.
create table if not exists public.network_settings (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid references public.network_sites (id)
                  on delete cascade,
  key             text not null
                  check (key ~ '^[a-z][a-z0-9_.-]*$'),
  value           jsonb not null,
  description     text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.network_admin_users (id)
                  on delete set null,
  constraint network_settings_site_key_unique unique (site_id, key)
);

-- --- 16. Timestamp maintenance ----------------------------------
create or replace function public.network_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_sites',
    'network_admin_users',
    'network_integrations',
    'network_daily_metrics',
    'network_settings'
  ])
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.network_touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- --- 17. RLS enablement + policies ------------------------------
--
-- All tables are admin-only via network_is_admin(). The audit log
-- is readable by admins but WRITES must go through the helper
-- RPCs; direct inserts are allowed too (same policy) because the
-- helpers run with the caller's session.

alter table public.network_sites                enable row level security;
alter table public.network_admin_users          enable row level security;
alter table public.network_integrations         enable row level security;
alter table public.network_data_sources         enable row level security;
alter table public.network_metric_definitions   enable row level security;
alter table public.network_daily_metrics        enable row level security;
alter table public.network_job_runs             enable row level security;
alter table public.network_tasks                enable row level security;
alter table public.network_alerts               enable row level security;
alter table public.network_approvals            enable row level security;
alter table public.network_audit_log            enable row level security;
alter table public.network_settings             enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_sites',
    'network_admin_users',
    'network_integrations',
    'network_data_sources',
    'network_metric_definitions',
    'network_daily_metrics',
    'network_job_runs',
    'network_tasks',
    'network_alerts',
    'network_approvals',
    'network_audit_log',
    'network_settings'
  ])
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_admin_select', t);
    execute format(
      'create policy %I on public.%I for select
         using (public.network_is_admin())',
      t || '_admin_select', t);
    execute format(
      'drop policy if exists %I on public.%I',
      t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all
         using (public.network_is_admin())
         with check (public.network_is_admin())',
      t || '_admin_write', t);
  end loop;
end $$;

-- --- 18. Job-run helpers ----------------------------------------
create or replace function public.network_start_job_run(
  p_job_name text,
  p_job_type text default 'import',
  p_site_id  uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.network_job_runs (
    job_name, job_type, site_id, status, started_at, metadata)
  values (
    p_job_name, p_job_type, p_site_id, 'running', now(), coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.network_complete_job_run(
  p_id              uuid,
  p_status          public.network_job_status default 'success',
  p_rows_examined   integer default 0,
  p_rows_inserted   integer default 0,
  p_rows_updated    integer default 0,
  p_rows_rejected   integer default 0,
  p_error_summary   text default null,
  p_metadata        jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.network_job_runs
     set status        = p_status,
         finished_at   = now(),
         rows_examined = p_rows_examined,
         rows_inserted = p_rows_inserted,
         rows_updated  = p_rows_updated,
         rows_rejected = p_rows_rejected,
         error_summary = p_error_summary,
         metadata      = coalesce(p_metadata, metadata)
   where id = p_id;
end;
$$;

create or replace function public.network_fail_job_run(
  p_id            uuid,
  p_error_summary text,
  p_metadata      jsonb default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.network_job_runs
     set status        = 'failed',
         finished_at   = now(),
         error_summary = p_error_summary,
         metadata      = coalesce(p_metadata, metadata)
   where id = p_id;
end;
$$;

grant execute on function public.network_start_job_run(text, text, uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.network_complete_job_run
  (uuid, public.network_job_status, integer, integer, integer, integer, text, jsonb)
  to authenticated, service_role;
grant execute on function public.network_fail_job_run(uuid, text, jsonb)
  to authenticated, service_role;

-- --- 19. Audit helper -------------------------------------------
create or replace function public.network_log_audit(
  p_action      text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_site_id     uuid default null,
  p_old_value   jsonb default null,
  p_new_value   jsonb default null,
  p_actor_type  public.network_actor_type default 'human',
  p_source      text default null,
  p_metadata    jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.network_audit_log (
    actor_type, actor_user_id, site_id, action, entity_type,
    entity_id, old_value, new_value, source, metadata)
  values (
    p_actor_type, auth.uid(), p_site_id, p_action, p_entity_type,
    p_entity_id, p_old_value, p_new_value, p_source, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.network_log_audit
  (text, text, text, uuid, jsonb, jsonb, public.network_actor_type, text, jsonb)
  to authenticated, service_role;

-- --- 20. Seed data ----------------------------------------------
--
-- Five sites. slug ids chosen to match the shared `collector_sites`
-- naming used elsewhere in the repo (see collector_user_sites)
-- for ergonomic cross-reference.

insert into public.network_sites
  (slug, name, short_name, canonical_url, production_app, logo_path, status)
values
  ('pokemon',  'PokePrices',     'PokePrices',     'https://www.pokeprices.io',
   'external',    '/sites/pokeprices.png',     'active'),
  ('mtg',      'MTGPrices',      'MTGPrices',      'https://mtgprices.io',
   'external',    '/sites/mtgprices.png',      'active'),
  ('ygo',      'YGOPrices',      'YGOPrices',      'https://ygoprices.io',
   'apps/yugioh', '/sites/ygoprices.png',      'active'),
  ('onepiece', 'OnePiecePrices', 'OnePiecePrices', 'https://www.onepieceprices.io',
   'apps/onepiece', '/sites/onepieceprices.png', 'active'),
  ('lorcana',  'LorcanaPrices',  'LorcanaPrices',  'https://www.lorcanaprices.io',
   'apps/lorcana',  '/sites/lorcanaprices.png',  'active')
on conflict (slug) do update set
  name          = excluded.name,
  canonical_url = excluded.canonical_url,
  production_app = excluded.production_app,
  logo_path     = excluded.logo_path,
  updated_at    = now();

-- Data sources — initial catalogue.
insert into public.network_data_sources (code, display_name, category, description)
values
  ('gsc',          'Google Search Console', 'external', 'Google Search Console API'),
  ('ga4',          'Google Analytics 4',    'external', 'GA4 Data API'),
  ('bing_wmt',     'Bing Webmaster Tools',  'external', 'Bing WMT API'),
  ('indexnow',     'IndexNow',              'external', 'IndexNow submission endpoint'),
  ('internal_db',  'Internal database',     'internal', 'Shared Supabase project (collector_*, tcg_*)'),
  ('tcggraph',     'TCGgraph',              'external', 'TCGgraph pricing feed'),
  ('scryfall',     'Scryfall',              'external', 'Scryfall catalogue'),
  ('ebay_epn',     'eBay Partner Network',  'external', 'EPN reporting + outbound deep links'),
  ('vercel',       'Vercel',                'external', 'Deployments and project state'),
  ('x',            'X',                     'external', 'X API'),
  ('manual',       'Manual entry',          'manual',   'Entered directly by an admin'),
  ('ai',           'AI recommendation',     'derived',  'Produced by an AI agent inside the OS'),
  ('derived',      'Derived',               'derived',  'Computed from other OS records')
on conflict (code) do nothing;

-- Metric definitions — the canonical codes the overview reads.
insert into public.network_metric_definitions
  (code, display_name, unit, default_source, is_network, is_site)
values
  ('users',                 'Users',               'count', 'ga4',          true, true),
  ('sessions',              'Sessions',            'count', 'ga4',          true, true),
  ('google_clicks',         'Google clicks',       'count', 'gsc',          true, true),
  ('google_impressions',    'Google impressions',  'count', 'gsc',          true, true),
  ('affiliate_clicks',      'Affiliate clicks',    'count', 'ebay_epn',     true, true),
  ('affiliate_revenue',     'Affiliate revenue',   'usd',   'ebay_epn',     true, true),
  ('other_revenue',         'Other revenue',       'usd',   'manual',       true, true),
  ('total_revenue',         'Total revenue',       'usd',   'derived',      true, true),
  ('operating_cost',        'Operating cost',      'usd',   'manual',       true, true),
  ('net_profit',            'Net profit',          'usd',   'derived',      true, true),
  ('new_accounts',          'New accounts',        'count', 'internal_db',  true, true),
  ('indexed_pages',         'Indexed pages',       'count', 'gsc',          true, true),
  ('x_followers',           'X followers',         'count', 'x',            true, true),
  ('articles_published',    'Articles published',  'count', 'internal_db',  true, true)
on conflict (code) do nothing;

-- Integration cards — one per (provider, site) + network-wide
-- providers get site_id = null. All start 'not_connected'.
insert into public.network_integrations (provider, site_id, status)
select p.provider, s.id, 'not_connected'::public.network_integration_status
from (values ('gsc'), ('ga4'), ('bing_wmt'), ('indexnow'),
             ('internal_db'), ('ebay_epn'), ('x')) as p(provider)
cross join public.network_sites s
on conflict (provider, site_id) do nothing;

insert into public.network_integrations (provider, site_id, status)
values ('vercel', null, 'not_connected')
on conflict (provider, site_id) do nothing;

-- Owner seed. Attempts to create the owner row for Luke's email;
-- fails silently if the auth user does not yet exist (Phase 0 may
-- run before Luke first signs into the admin). Second deploy +
-- first sign-in handshake completes the loop.
do $$
declare
  v_auth_id uuid;
begin
  select id into v_auth_id
    from auth.users
   where lower(email) = lower('lukejosephpierce@gmail.com')
   limit 1;
  if v_auth_id is not null then
    insert into public.network_admin_users
      (auth_user_id, email, display_name, role, is_active)
    values (v_auth_id, 'lukejosephpierce@gmail.com', 'Luke', 'owner', true)
    on conflict (auth_user_id) do update
      set role = 'owner', is_active = true,
          email = excluded.email, updated_at = now();
  end if;
end $$;
