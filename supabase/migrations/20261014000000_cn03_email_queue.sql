-- CN-03: Collector Network cross-site email queue and per-site
-- onboarding state. Idempotent; safe to re-run.
--
-- These tables extend the existing PokePrices email infrastructure
-- (email_contacts, email_consents, email_suppressions,
-- email_delivery_log, email_webhook_events) to serve MTG, YGO,
-- OnePiece and Lorcana sites. PokePrices continues to use its own
-- site-local tables (email_onboarding_state, user_alert_preferences);
-- no PokePrices behaviour changes.
--
-- Writer is the service role (CN hub cron routes). Readers are the
-- admin UI (via network_is_admin() RLS) plus the owner's own rows.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. collector_email_queue — cross-site transactional send queue
-- ─────────────────────────────────────────────────────────────

create table if not exists public.collector_email_queue (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete cascade,
  recipient_email text not null,
  site_code       text not null references public.collector_sites(code) on delete restrict,
  template_key    text not null,
  category        text not null,
  variables       jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  send_after      timestamptz not null default now(),
  status          text not null default 'pending'
                     check (status in ('pending','sending','sent','failed','skipped','suppressed')),
  attempts        int  not null default 0,
  last_error      text,
  resend_email_id text,
  sent_at         timestamptz,
  skipped_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint collector_email_queue_idem_uq unique (idempotency_key)
);

create index if not exists collector_email_queue_pending_idx
  on public.collector_email_queue (send_after)
  where status = 'pending';

create index if not exists collector_email_queue_user_site_idx
  on public.collector_email_queue (user_id, site_code);

create index if not exists collector_email_queue_status_idx
  on public.collector_email_queue (status, created_at desc);

alter table public.collector_email_queue enable row level security;

drop policy if exists "user reads own queue rows" on public.collector_email_queue;
create policy "user reads own queue rows"
  on public.collector_email_queue for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies. Service role only.
-- Admin reads go via `network_admin_users` membership + the admin
-- client (service role), not this policy.

comment on table public.collector_email_queue is
  'CN-03: cross-site email queue drained by apps/hub cron. Writer is service role; owners can read their own rows for diagnostics.';

-- ─────────────────────────────────────────────────────────────
-- 2. collector_site_onboarding — per-user per-site progress
-- ─────────────────────────────────────────────────────────────

create table if not exists public.collector_site_onboarding (
  user_id              uuid not null references auth.users(id) on delete cascade,
  site_code            text not null references public.collector_sites(code) on delete restrict,
  welcome_enqueued_at  timestamptz,
  welcome_sent_at      timestamptz,
  day2_enqueued_at     timestamptz,
  day2_sent_at         timestamptz,
  day7_enqueued_at     timestamptz,
  day7_sent_at         timestamptz,
  weekly_last_sent_at  timestamptz,
  weekly_last_at       timestamptz,
  status               text not null default 'active'
                           check (status in ('active','completed','paused','cancelled')),
  cancellation_reason  text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (user_id, site_code)
);

create index if not exists collector_site_onboarding_weekly_idx
  on public.collector_site_onboarding (site_code, weekly_last_sent_at);

create index if not exists collector_site_onboarding_pending_welcome_idx
  on public.collector_site_onboarding (site_code)
  where welcome_sent_at is null and status = 'active';

alter table public.collector_site_onboarding enable row level security;

drop policy if exists "user reads own onboarding" on public.collector_site_onboarding;
create policy "user reads own onboarding"
  on public.collector_site_onboarding for select
  using (auth.uid() = user_id);

comment on table public.collector_site_onboarding is
  'CN-03: per-user per-site onboarding progress. Service role writes; owner reads own rows. Lives alongside PokePrices email_onboarding_state (unchanged).';

-- ─────────────────────────────────────────────────────────────
-- 3. collector_portfolio_snapshots — minimal weekly value anchor
--
-- Purpose: let the weekly-digest cron report a "value last week vs
-- this week" delta per (user_id, site_code) without inventing data.
-- Populated opportunistically by the weekly cron itself before it
-- sends. First send → no delta (we say so in copy). Second send onward
-- → honest week-over-week number.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.collector_portfolio_snapshots (
  user_id         uuid not null references auth.users(id) on delete cascade,
  site_code       text not null references public.collector_sites(code) on delete restrict,
  snapshot_at     timestamptz not null default now(),
  total_value_minor bigint,         -- in minor units (e.g. pennies)
  currency        text not null default 'GBP',
  holding_count   int not null default 0,
  details         jsonb not null default '{}'::jsonb,
  primary key (user_id, site_code, snapshot_at)
);

create index if not exists collector_portfolio_snapshots_latest_idx
  on public.collector_portfolio_snapshots (user_id, site_code, snapshot_at desc);

alter table public.collector_portfolio_snapshots enable row level security;

drop policy if exists "user reads own snapshots" on public.collector_portfolio_snapshots;
create policy "user reads own snapshots"
  on public.collector_portfolio_snapshots for select
  using (auth.uid() = user_id);

comment on table public.collector_portfolio_snapshots is
  'CN-03: honest weekly portfolio value anchors per (user, site). No synthetic back-dated rows.';

-- ─────────────────────────────────────────────────────────────
-- 4. updated_at touch triggers (reuse existing fn if present)
-- ─────────────────────────────────────────────────────────────

create or replace function public.cn03_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists cn03_queue_touch on public.collector_email_queue;
create trigger cn03_queue_touch
  before update on public.collector_email_queue
  for each row execute function public.cn03_touch_updated_at();

drop trigger if exists cn03_onboarding_touch on public.collector_site_onboarding;
create trigger cn03_onboarding_touch
  before update on public.collector_site_onboarding
  for each row execute function public.cn03_touch_updated_at();

commit;
