# Collector Network schema request — Slice CN-D1

Status: **AWAITING APPLY** — pending preflightluke running the
SQL against project `egidpsrkqvymvioidatc` via the Supabase SQL
Editor. Matches the CN-A / CN-B pattern (manual apply).

Adds the tables the forward marketing-sync worker needs. Does
NOT touch:

- `collector_sites`, `collector_user_sites`,
  `collector_marketing_preferences`,
  `collector_marketing_consent_events`,
  `collector_signup_context`, `collector_consent_versions`
  (all owned by CN-A / CN-B; treated read-only by CN-D1).
- The consent-source CHECK constraint (which still lists
  `brevo_webhook` as inert-but-valid). Adding
  `resend_webhook` is deferred to CN-D2 with a
  pre-migration `count(*) where source='brevo_webhook' = 0`
  assertion.

## Migration

Idempotent; single transaction; safe to re-run.

```sql
begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Config singleton — holds the Resend segment UUID.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_config (
  id                text primary key check (id = 'primary'),
  resend_segment_id text not null,
  updated_at        timestamptz not null default now()
);

drop trigger if exists collector_marketing_config_touch on collector_marketing_config;
create trigger collector_marketing_config_touch
  before update on collector_marketing_config
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_config enable row level security;
-- No policies granted. Writes via service-role worker only.

-- ─────────────────────────────────────────────────────────────
-- 2. Topic mapping — one row per (scope, site_code).
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_topics (
  scope                 text not null check (scope in ('site','network')),
  site_code             text references collector_sites(code),
  resend_topic_id       text not null,
  active                boolean not null default true,
  default_subscription  text not null default 'opt_out'
                        check (default_subscription in ('opt_in','opt_out')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((scope = 'site' and site_code is not null)
      or (scope = 'network' and site_code is null))
);

create unique index if not exists collector_marketing_topics_scope_site
  on collector_marketing_topics (scope, coalesce(site_code, ''));

drop trigger if exists collector_marketing_topics_touch on collector_marketing_topics;
create trigger collector_marketing_topics_touch
  before update on collector_marketing_topics
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_topics enable row level security;
-- No policies granted.

-- ─────────────────────────────────────────────────────────────
-- 3. Stable Resend contact mapping.
--    user_id ↔ resend_contact_id. Survives email changes.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_contacts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  resend_contact_id  text not null unique,
  synced_email       text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_synced_at     timestamptz not null default now(),
  last_sync_status   text not null default 'ok'
                     check (last_sync_status in ('ok','error'))
);

create index if not exists collector_marketing_contacts_synced_email_idx
  on collector_marketing_contacts (synced_email);

drop trigger if exists collector_marketing_contacts_touch on collector_marketing_contacts;
create trigger collector_marketing_contacts_touch
  before update on collector_marketing_contacts
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_contacts enable row level security;
-- No policies granted.

-- ─────────────────────────────────────────────────────────────
-- 4. Sync watermark singleton — composite cursor.
--    (last_event_occurred_at, last_event_id) is a total order
--    over collector_marketing_consent_events. The worker reads
--    events with (occurred_at, id::text) > cursor and advances
--    both fields after a successful commit.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_sync_state (
  id                       text primary key check (id = 'primary'),
  last_event_occurred_at   timestamptz,
  last_event_id            uuid,
  last_run_at              timestamptz,
  last_error               text,
  updated_at               timestamptz not null default now()
);

insert into collector_marketing_sync_state (id) values ('primary')
  on conflict (id) do nothing;

drop trigger if exists collector_marketing_sync_state_touch on collector_marketing_sync_state;
create trigger collector_marketing_sync_state_touch
  before update on collector_marketing_sync_state
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_sync_state enable row level security;
-- No policies granted.

-- ─────────────────────────────────────────────────────────────
-- 5. Per-user retry state — decoupled from the event feed.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_sync_failures (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  attempts        integer not null default 1,
  last_error      text not null,
  last_attempt_at timestamptz not null default now(),
  next_retry_at   timestamptz
);

create index if not exists collector_marketing_sync_failures_next_retry_idx
  on collector_marketing_sync_failures (next_retry_at);

alter table collector_marketing_sync_failures enable row level security;
-- No policies granted.

-- ─────────────────────────────────────────────────────────────
-- 6. RPCs the worker calls.
-- ─────────────────────────────────────────────────────────────

-- Composite-cursor event feed. Returns consent events with
-- (occurred_at, id::text) > (p_last_occurred_at, p_last_event_id::text)
-- AND occurred_at < now() - p_lag_seconds. The lag ensures
-- concurrent-timestamp writes have committed before we read
-- them; the composite cursor gives a total order over
-- collector_marketing_consent_events with no schema mutation
-- to CN-A.
--
-- Read-only. SECURITY DEFINER so the worker doesn't need any
-- direct SELECT grant on the consent-events table.
create or replace function public.collector_marketing_events_since(
  p_last_occurred_at         timestamptz,
  p_last_event_id            uuid,
  p_lag_seconds              integer,
  p_limit                    integer
)
returns table (
  id          uuid,
  user_id     uuid,
  occurred_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select e.id, e.user_id, e.occurred_at
  from public.collector_marketing_consent_events e
  where
    e.occurred_at < (now() - make_interval(secs => p_lag_seconds))
    and (
      p_last_occurred_at is null
      or e.occurred_at > p_last_occurred_at
      or (e.occurred_at = p_last_occurred_at and e.id::text > coalesce(p_last_event_id::text, ''))
    )
  order by e.occurred_at asc, e.id::text asc
  limit greatest(1, coalesce(p_limit, 100));
$$;

revoke all on function public.collector_marketing_events_since(timestamptz, uuid, integer, integer) from public;
-- Service role auto-grants; nothing else needed for the worker.

-- Upsert a sync failure with exponential backoff based on the
-- current attempts count. Called by the worker after each
-- per-user failure. `p_initial_backoff_seconds` is the base
-- (attempts=1 wait); backoff doubles up to a 1-hour cap.
create or replace function public.collector_marketing_sync_record_failure(
  p_user_id                  uuid,
  p_error_tag                text,
  p_now                      timestamptz,
  p_initial_backoff_seconds  integer default 60
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
  v_backoff  integer;
begin
  select attempts into v_attempts
    from public.collector_marketing_sync_failures
    where user_id = p_user_id;

  v_attempts := coalesce(v_attempts, 0) + 1;
  v_backoff  := least(
    p_initial_backoff_seconds * power(2, v_attempts - 1)::integer,
    3600
  );

  insert into public.collector_marketing_sync_failures
    (user_id, attempts, last_error, last_attempt_at, next_retry_at)
  values
    (p_user_id, v_attempts, p_error_tag, p_now, p_now + make_interval(secs => v_backoff))
  on conflict (user_id) do update
    set attempts        = v_attempts,
        last_error      = p_error_tag,
        last_attempt_at = p_now,
        next_retry_at   = p_now + make_interval(secs => v_backoff);
end;
$$;

revoke all on function public.collector_marketing_sync_record_failure(uuid, text, timestamptz, integer) from public;

commit;
```

## Post-migration seed (run AFTER Resend Segment + Topics exist)

Preflightluke performs the manual Resend-dashboard steps
(`docs/network/cn-d1-deploy.md`) to obtain the three UUIDs,
then runs:

```sql
begin;

insert into collector_marketing_config (id, resend_segment_id)
values ('primary', '<SEGMENT-ID-FROM-RESEND>');

insert into collector_marketing_topics
  (scope,     site_code, resend_topic_id,       active, default_subscription)
values
  ('site',    'ygo',     '<YGO-TOPIC-ID>',      true,   'opt_out'),
  ('network', null,      '<NETWORK-TOPIC-ID>',  true,   'opt_out');

commit;
```

## What this migration does NOT do

- Does not touch any CN-A/CN-B table's schema, constraints, or
  RLS policies.
- Does not modify the consent-source CHECK constraints.
- Does not install pg_cron jobs. Scheduling lands via a
  separate manual step in `docs/network/cn-d1-deploy.md`
  after Supabase Vault carries the trigger secret.
- Does not seed any consent preference row. CN-D1 never
  writes consent state — Supabase remains the source of
  truth.
