-- CN-STOCK-02 · scheduled stock-alert engine
--
-- Four tables, all admin-RLS, additive. Never deployed live until
-- STOCK_PROBE_ENABLED env var is flipped on the Hub Vercel project.
--
-- Naming convention: cn_stock_* prefix (matches cn_psa_* for the
-- gated PSA infrastructure). Schema below mirrors the apps/hub/src/
-- server/stock/types.ts shape 1:1.
--
-- Retention policy:
--   * cn_stock_watchlist      long-lived (one row per monitored listing)
--   * cn_stock_observations   SHORT (30 days) — the raw check log
--   * cn_stock_events         long-lived (confirmed transitions,
--                             small volume, worth keeping for audit)
--   * cn_stock_outbox         long-lived with a delivered rows

-- ─────────────────── cn_stock_watchlist ────────────────────────
--
-- One row per monitored (retailer, product_url) listing. The
-- state machine's authoritative "current confirmed state" lives
-- here. consecutive_* counters support the "repeat confirmation
-- before alerting" rule.

create table if not exists public.cn_stock_watchlist (
  id                             uuid primary key default gen_random_uuid(),
  retailer                       text not null,
  country                        text not null
                                 check (country in ('UK','US','EU','CA','AU','JP','OTHER')),
  game                           text not null
                                 check (game in ('pokemon','mtg','ygo','onepiece','lorcana','other')),
  product_name                   text not null,
  variant                        text,
  url                            text not null,
  monitoring_enabled             boolean not null default true,
  check_interval_minutes         integer not null default 15
                                 check (check_interval_minutes >= 5 and check_interval_minutes <= 1440),
  last_confirmed_state           text
                                 check (last_confirmed_state is null
                                        or last_confirmed_state in ('in_stock','out_of_stock','preorder')),
  last_observation_state         text
                                 check (last_observation_state is null
                                        or last_observation_state in ('in_stock','out_of_stock','preorder','unknown','blocked')),
  last_price                     numeric(10,2),
  last_currency                  text,
  last_observed_at               timestamptz,
  last_state_changed_at          timestamptz,
  last_check_attempted_at        timestamptz,
  next_check_at                  timestamptz not null default now(),
  consecutive_in_stock_count     integer not null default 0,
  consecutive_out_of_stock_count integer not null default 0,
  consecutive_unknown_count      integer not null default 0,
  consecutive_blocked_count      integer not null default 0,
  consecutive_fail_count         integer not null default 0,
  notes                          text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  constraint cn_stock_watchlist_url_unique unique (url)
);

create index if not exists cn_stock_watchlist_next_check_idx
  on public.cn_stock_watchlist (next_check_at)
  where monitoring_enabled;

create index if not exists cn_stock_watchlist_retailer_idx
  on public.cn_stock_watchlist (retailer);

-- updated_at trigger (reuse the existing network pattern if present;
-- defensive create otherwise).
create or replace function public.cn_stock_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists cn_stock_watchlist_touch on public.cn_stock_watchlist;
create trigger cn_stock_watchlist_touch
  before update on public.cn_stock_watchlist
  for each row execute function public.cn_stock_touch_updated_at();

-- ─────────────────── cn_stock_observations ─────────────────────
--
-- Append-only check log. Short retention (30 days) — the watchlist
-- carries the state, this table is for debugging + audit.

create table if not exists public.cn_stock_observations (
  id                   uuid primary key default gen_random_uuid(),
  watchlist_id         uuid not null references public.cn_stock_watchlist(id) on delete cascade,
  observed_at          timestamptz not null default now(),
  observation_state    text not null
                       check (observation_state in ('in_stock','out_of_stock','preorder','unknown','blocked')),
  http_status          integer,
  duration_ms          integer,
  bytes_downloaded     integer,
  extraction_method    text
                       check (extraction_method is null or extraction_method in ('json_ld','meta','microdata','none')),
  evidence_summary     text,
  identity_match       boolean,
  price                numeric(10,2),
  currency             text,
  error_detail         text,
  robots_gate_reason   text
);

create index if not exists cn_stock_observations_watchlist_time_idx
  on public.cn_stock_observations (watchlist_id, observed_at desc);

create index if not exists cn_stock_observations_recent_idx
  on public.cn_stock_observations (observed_at desc);

-- ─────────────────── cn_stock_events ───────────────────────────
--
-- Append-only confirmed state-change events. One row per
-- qualifying out_of_stock → in_stock (or other notifiable)
-- transition. transition_key enforces idempotency: concurrent /
-- duplicate workers trying to create the same event collide on
-- the UNIQUE constraint and the second insert is rejected
-- cleanly.

create table if not exists public.cn_stock_events (
  id                      uuid primary key default gen_random_uuid(),
  watchlist_id            uuid not null references public.cn_stock_watchlist(id) on delete cascade,
  transition_key          text not null,
  detected_at             timestamptz not null default now(),
  previous_state          text not null
                          check (previous_state in ('in_stock','out_of_stock','preorder')),
  new_state               text not null
                          check (new_state in ('in_stock','out_of_stock','preorder')),
  evidence_summary        text,
  price                   numeric(10,2),
  currency                text,
  notification_eligible   boolean not null default true,
  created_at              timestamptz not null default now(),
  constraint cn_stock_events_transition_key_unique unique (transition_key)
);

create index if not exists cn_stock_events_watchlist_time_idx
  on public.cn_stock_events (watchlist_id, detected_at desc);

create index if not exists cn_stock_events_recent_idx
  on public.cn_stock_events (detected_at desc);

-- ─────────────────── cn_stock_outbox ───────────────────────────
--
-- Durable Discord delivery queue. One row per (event × target).
-- Ambiguous webhook timeouts recorded in last_error without an
-- automatic retry — operator judges whether to resubmit.

create table if not exists public.cn_stock_outbox (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.cn_stock_events(id) on delete cascade,
  target             text not null,  -- 'discord:test', 'discord:ops', etc. (never the webhook URL)
  idempotency_key    text not null,
  payload            jsonb not null,
  status             text not null default 'pending'
                     check (status in ('pending','sending','delivered','failed_retryable','failed_permanent','timeout_ambiguous')),
  attempt_count      integer not null default 0,
  max_attempts       integer not null default 5,
  next_attempt_at    timestamptz not null default now(),
  last_attempted_at  timestamptz,
  delivered_at       timestamptz,
  last_error         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint cn_stock_outbox_idempotency_key_unique unique (idempotency_key)
);

create index if not exists cn_stock_outbox_pending_idx
  on public.cn_stock_outbox (next_attempt_at)
  where status in ('pending','failed_retryable');

create index if not exists cn_stock_outbox_event_idx
  on public.cn_stock_outbox (event_id);

drop trigger if exists cn_stock_outbox_touch on public.cn_stock_outbox;
create trigger cn_stock_outbox_touch
  before update on public.cn_stock_outbox
  for each row execute function public.cn_stock_touch_updated_at();

-- ─────────────────── RLS (admin-only) ───────────────────────────

alter table public.cn_stock_watchlist    enable row level security;
alter table public.cn_stock_observations enable row level security;
alter table public.cn_stock_events       enable row level security;
alter table public.cn_stock_outbox       enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'cn_stock_watchlist','cn_stock_observations','cn_stock_events','cn_stock_outbox'
  ]) loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())',
      t || '_admin_all', t
    );
  end loop;
end $$;

-- Revoke anon + authenticated; only service_role + admins (via RLS) touch these.
revoke all on public.cn_stock_watchlist    from anon, authenticated, public;
revoke all on public.cn_stock_observations from anon, authenticated, public;
revoke all on public.cn_stock_events       from anon, authenticated, public;
revoke all on public.cn_stock_outbox       from anon, authenticated, public;

notify pgrst, 'reload schema';
