-- Unified Intelligence Inbox (Phase 1).
--
-- Cross-domain ranked items surfaced at /admin/intelligence. Reads
-- upstream data (SEO opportunities, revenue daily, job runs, content
-- ideas, GSC/GA4 rollups) and writes a deterministic ranked feed.
--
-- Dedupe is by `source_key` which is a stable deterministic string
-- (e.g. "seo:striking_distance:<site_slug>:<url>" or "data_health:
-- stale_job:<job_name>"). The engine upserts on source_key so the
-- same underlying condition updates instead of duplicating.
--
-- Lifecycle (`status`):
--   open          Default. In the active feed.
--   task_created  Operator pressed "Create task". Still visible but
--                 shows the linked task_id.
--   snoozed       Hidden until snoozed_until.
--   resolved      Engine detected the condition no longer applies, OR
--                 operator explicitly closed it.
--   dismissed     Operator dismissed. Preserved for audit; does not
--                 reappear in the inbox unless priority materially
--                 improves (handled in engine).
--
-- Tone (`tone`): opportunity | risk | warning | positive |
-- informational. Independent of category — a REVENUE item may be a
-- positive or a warning.
--
-- Scores are integers 0..100. priority_score is computed by the
-- engine from the component scores using a central formula; it is
-- stored so sort-by-priority is a simple ORDER BY.

create extension if not exists pgcrypto;

-- ─── Enums ─────────────────────────────────────────────────────

do $$ begin
  create type network_intelligence_category as enum (
    'seo', 'content', 'revenue', 'monetisation',
    'technical', 'data_health', 'indexing', 'growth'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type network_intelligence_status as enum (
    'open', 'task_created', 'snoozed', 'resolved', 'dismissed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type network_intelligence_tone as enum (
    'opportunity', 'risk', 'warning', 'positive', 'informational'
  );
exception when duplicate_object then null; end $$;

-- ─── Table ────────────────────────────────────────────────────

create table if not exists network_intelligence_items (
  id                     uuid primary key default gen_random_uuid(),
  site_id                uuid references network_sites(id) on delete cascade,
  category               network_intelligence_category not null,
  type                   text not null,
  tone                   network_intelligence_tone not null default 'opportunity',
  title                  text not null,
  summary                text not null,
  recommended_action     text not null,
  evidence               jsonb not null default '{}'::jsonb,
  expected_upside        jsonb,

  -- Dedupe. Globally unique so the engine can upsert without a
  -- composite index. Convention:
  --   "<category>:<type>:<site_slug_or_network>:<stable_key>"
  -- e.g. "seo:striking_distance:ygo:/cards/dark-magician"
  source_type            text not null,
  source_id              text,
  source_key             text not null unique,

  -- Scores (deterministic in Phase 1).
  impact_score           smallint not null default 0 check (impact_score     between 0 and 100),
  confidence_score       smallint not null default 0 check (confidence_score between 0 and 100),
  urgency_score          smallint not null default 0 check (urgency_score    between 0 and 100),
  effort_score           smallint not null default 0 check (effort_score     between 0 and 100),
  priority_score         smallint not null default 0 check (priority_score   between 0 and 100),

  status                 network_intelligence_status not null default 'open',
  task_id                uuid references network_tasks(id) on delete set null,

  first_detected_at      timestamptz not null default now(),
  last_detected_at       timestamptz not null default now(),
  last_run_id            uuid,
  snoozed_until          timestamptz,
  resolved_at            timestamptz,
  resolved_reason        text,
  dismissed_at           timestamptz,
  dismissed_by           uuid references network_admin_users(id) on delete set null,
  dismiss_reason         text,
  -- Score snapshot captured when the item was dismissed. The engine
  -- compares the current priority to this to decide whether to
  -- re-open a dismissed item (only when priority rises by >= 25).
  dismissed_priority     smallint,

  metadata               jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists network_intelligence_items_feed_idx
  on network_intelligence_items (status, priority_score desc, last_detected_at desc)
  where status in ('open', 'task_created');

create index if not exists network_intelligence_items_site_idx
  on network_intelligence_items (site_id, status, priority_score desc);

create index if not exists network_intelligence_items_category_idx
  on network_intelligence_items (category, status);

create index if not exists network_intelligence_items_snoozed_idx
  on network_intelligence_items (snoozed_until)
  where status = 'snoozed';

-- Trigger: keep updated_at fresh.
create or replace function network_intelligence_items_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists network_intelligence_items_touch_tr on network_intelligence_items;
create trigger network_intelligence_items_touch_tr
before update on network_intelligence_items
for each row execute function network_intelligence_items_touch();

-- RLS: service-role writes only; admin-authenticated session reads.
alter table network_intelligence_items enable row level security;

drop policy if exists network_intelligence_items_admin_read on network_intelligence_items;
create policy network_intelligence_items_admin_read on network_intelligence_items
  for select
  using (
    exists (
      select 1 from network_admin_users
      where network_admin_users.auth_user_id = auth.uid()
    )
  );

drop policy if exists network_intelligence_items_admin_write on network_intelligence_items;
create policy network_intelligence_items_admin_write on network_intelligence_items
  for all
  using (
    exists (
      select 1 from network_admin_users
      where network_admin_users.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from network_admin_users
      where network_admin_users.auth_user_id = auth.uid()
    )
  );

grant select on network_intelligence_items to authenticated;
grant all    on network_intelligence_items to service_role;

comment on table network_intelligence_items is
  'Phase-1 unified intelligence inbox. Deterministic ranked items from upstream signals (SEO opportunities, revenue, job runs, content ideas). source_key is globally unique for dedupe. Scores integer 0..100; priority_score computed by engine.';
