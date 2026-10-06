-- =============================================================
-- Phase 6 Checkpoint A · Article Autopilot foundation
-- =============================================================
-- Reusable, OFF-by-default schema the Autopilot pipeline will stand
-- on. No AI calls, no publication, no scheduled generation yet.
--
-- Design decisions:
--
-- * The scored editorial queue EXTENDS public.network_content_ideas
--   rather than introducing a parallel network_article_opportunities
--   table. Ideas already carry (site, dedupe_key, origin, evidence,
--   priority, status); adding a few autopilot-specific columns keeps
--   state in one place and avoids drift.
--
-- * Autopilot-specific lifecycle lives in a new text column
--   `autopilot_state` (null when not touched). The existing
--   `network_idea_status` enum (`new, in_brief, drafting, published,
--   dismissed, stale`) stays unchanged — autopilot_state is additive,
--   not a replacement.
--
-- * Budget enforcement uses a dedicated table +
--   SECURITY DEFINER RPCs that take a pg_advisory_xact_lock so two
--   concurrent autopilot runs cannot both see the same remaining
--   budget. Reservation statuses: reserved | consumed | released
--   | failed. Only `reserved` + `consumed` count toward spend.
--
-- * No table in migrations today called
--   network_article_performance_snapshots (verified by grepping
--   supabase/migrations/*). We create one here fresh.

-- ─────────────────────────────────────────────────────────────
-- 1. network_autopilot_config  (singleton + per-site key/value)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_autopilot_config (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,                        -- 'global' | 'site:<slug>'
  key         text not null,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.network_admin_users (id) on delete set null,
  unique (scope, key)
);

create index if not exists network_autopilot_config_scope_idx
  on public.network_autopilot_config (scope);

alter table public.network_autopilot_config enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_autopilot_config'
      and policyname = 'network_autopilot_config_admin'
  ) then
    create policy network_autopilot_config_admin
      on public.network_autopilot_config
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

comment on table public.network_autopilot_config
  is 'Autopilot admin-editable settings. scope=global for network-wide; scope=site:<slug> for per-site overrides.';

-- ─────────────────────────────────────────────────────────────
-- 2. network_ai_budget_reservations
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_ai_budget_reservations (
  id                 uuid primary key default gen_random_uuid(),
  autopilot_run_id   uuid,                                 -- links a reservation to a single autopilot invocation
  article_id         uuid references public.network_articles (id) on delete set null,
  idea_id            uuid references public.network_content_ideas (id) on delete set null,
  site_id            uuid references public.network_sites (id) on delete set null,
  estimated_cost_usd numeric(10, 4) not null,
  actual_cost_usd    numeric(10, 4),                       -- populated on consume
  status             text not null default 'reserved'
                     check (status in ('reserved', 'consumed', 'released', 'failed')),
  reason             text,                                 -- reason for release/fail
  created_at         timestamptz not null default now(),
  consumed_at        timestamptz,
  released_at        timestamptz
);

create index if not exists network_ai_budget_reservations_status_time_idx
  on public.network_ai_budget_reservations (status, created_at desc);
create index if not exists network_ai_budget_reservations_run_idx
  on public.network_ai_budget_reservations (autopilot_run_id);
create index if not exists network_ai_budget_reservations_site_idx
  on public.network_ai_budget_reservations (site_id);

alter table public.network_ai_budget_reservations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_ai_budget_reservations'
      and policyname = 'network_ai_budget_reservations_admin'
  ) then
    create policy network_ai_budget_reservations_admin
      on public.network_ai_budget_reservations
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. network_article_evidence_packs  (immutable snapshots)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_article_evidence_packs (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid references public.network_articles (id) on delete cascade,
  idea_id         uuid references public.network_content_ideas (id) on delete set null,
  autopilot_run_id uuid,
  schema_version  text not null default '1',
  content_hash    text not null,                            -- sha256 of canonical payload for audit
  built_at        timestamptz not null default now(),
  payload         jsonb not null                            -- the compact evidence pack
);

create index if not exists network_article_evidence_packs_article_idx
  on public.network_article_evidence_packs (article_id, built_at desc);
create index if not exists network_article_evidence_packs_hash_idx
  on public.network_article_evidence_packs (content_hash);

alter table public.network_article_evidence_packs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_article_evidence_packs'
      and policyname = 'network_article_evidence_packs_admin'
  ) then
    create policy network_article_evidence_packs_admin
      on public.network_article_evidence_packs
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

comment on table public.network_article_evidence_packs
  is 'Immutable, versioned deterministic evidence pack built BEFORE AI generation. The AI prompt renders ONLY from this pack + the voice profile. Preserved so later we can prove exactly what evidence the model saw.';

-- ─────────────────────────────────────────────────────────────
-- 4. network_article_qa_findings
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'network_qa_source') then
    create type public.network_qa_source as enum ('deterministic', 'semantic_ai');
  end if;
  if not exists (select 1 from pg_type where typname = 'network_qa_severity') then
    create type public.network_qa_severity as enum ('blocker', 'warning', 'info');
  end if;
end $$;

create table if not exists public.network_article_qa_findings (
  id             uuid primary key default gen_random_uuid(),
  article_id     uuid references public.network_articles (id) on delete cascade,
  evidence_pack_id uuid references public.network_article_evidence_packs (id) on delete set null,
  source         public.network_qa_source not null,
  check_name     text not null,                              -- stable token, e.g. 'price_claim_traceable'
  severity       public.network_qa_severity not null,
  message        text,                                       -- human-readable explanation
  evidence       jsonb not null default '{}'::jsonb,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists network_article_qa_findings_article_idx
  on public.network_article_qa_findings (article_id, severity, resolved_at);

alter table public.network_article_qa_findings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_article_qa_findings'
      and policyname = 'network_article_qa_findings_admin'
  ) then
    create policy network_article_qa_findings_admin
      on public.network_article_qa_findings
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 5. network_article_perf_snapshots (D1/D7/D14/D28/D90)
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_article_perf_snapshots (
  id                      uuid primary key default gen_random_uuid(),
  article_id              uuid not null references public.network_articles (id) on delete cascade,
  bucket                  text not null check (bucket in ('d1', 'd7', 'd14', 'd28', 'd90')),
  snapshot_date           date not null,
  age_days                integer not null,
  clicks                  integer,
  impressions             integer,
  ctr                     numeric(8, 6),
  avg_position            numeric(6, 2),
  users                   integer,
  sessions                integer,
  affiliate_clicks        integer,
  affiliate_revenue_minor bigint,
  currency                text,
  created_at              timestamptz not null default now(),
  unique (article_id, bucket)
);

create index if not exists network_article_perf_snapshots_article_idx
  on public.network_article_perf_snapshots (article_id, bucket);

alter table public.network_article_perf_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_article_perf_snapshots'
      and policyname = 'network_article_perf_snapshots_admin'
  ) then
    create policy network_article_perf_snapshots_admin
      on public.network_article_perf_snapshots
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

comment on table public.network_article_perf_snapshots
  is 'Age-cohort performance snapshots per article. Measurement engine lands in a later checkpoint; schema here so the ingest column shape is fixed.';

-- ─────────────────────────────────────────────────────────────
-- 6. Column extensions on existing tables
-- ─────────────────────────────────────────────────────────────

do $$
begin
  -- network_content_ideas: scoring + autopilot lifecycle + holds
  alter table public.network_content_ideas
    add column if not exists score                 numeric(6, 2),
    add column if not exists score_breakdown       jsonb not null default '{}'::jsonb,
    add column if not exists decision              text,                 -- 'new_article' | 'refresh' | 'internal_link_reinforce' | 'skip'
    add column if not exists target_article_id     uuid references public.network_articles (id) on delete set null,
    add column if not exists budget_cents_estimate integer,
    add column if not exists hold_reasons          text[] not null default '{}',
    add column if not exists autopilot_state       text,                 -- 'queued' | 'scored' | 'reserved' | 'generating' | 'held' | 'published' | 'dismissed'
    add column if not exists autopilot_run_id      uuid,
    add column if not exists scored_at             timestamptz;

  -- network_articles: hold reasons + actual cost + autopilot run link
  alter table public.network_articles
    add column if not exists hold_reasons        text[] not null default '{}',
    add column if not exists budget_cents_actual integer,
    add column if not exists autopilot_run_id    uuid;

  -- network_ai_cost_log: autopilot_run_id so costs can be grouped per run
  alter table public.network_ai_cost_log
    add column if not exists autopilot_run_id uuid;
end $$;

create index if not exists network_content_ideas_autopilot_idx
  on public.network_content_ideas (autopilot_state, score)
  where autopilot_state is not null;

create index if not exists network_articles_hold_idx
  on public.network_articles using gin (hold_reasons)
  where hold_reasons <> '{}';

create index if not exists network_ai_cost_log_run_idx
  on public.network_ai_cost_log (autopilot_run_id)
  where autopilot_run_id is not null;

-- ─────────────────────────────────────────────────────────────
-- 7. Budget reservation RPCs (atomic via pg_advisory_xact_lock)
-- ─────────────────────────────────────────────────────────────
--
-- Lock scope: all four RPCs take the same advisory lock so two
-- concurrent reserve/consume/release calls cannot interleave their
-- views of the ledger. The lock is per-transaction and released at
-- commit/rollback. Short-lived — reads a few config rows + inserts a
-- single row — so contention is a non-issue in practice.

create or replace function public.network_reserve_ai_budget(
  p_autopilot_run_id uuid,
  p_site_id          uuid,
  p_idea_id          uuid,
  p_estimated_usd    numeric
)
returns table(reservation_id uuid, reserved boolean, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key           bigint := hashtextextended('network_autopilot_budget', 0);
  v_max_per_article    numeric;
  v_daily_cap          numeric;
  v_monthly_cap        numeric;
  v_today              numeric;
  v_month              numeric;
  v_new_id             uuid;
begin
  perform pg_advisory_xact_lock(v_lock_key);

  if p_estimated_usd is null or p_estimated_usd < 0 then
    return query select null::uuid, false, 'invalid_estimate';
    return;
  end if;

  select (value #>> '{}')::numeric into v_max_per_article
    from public.network_autopilot_config where scope = 'global' and key = 'max_cost_per_article_usd';
  select (value #>> '{}')::numeric into v_daily_cap
    from public.network_autopilot_config where scope = 'global' and key = 'daily_article_budget_usd';
  select (value #>> '{}')::numeric into v_monthly_cap
    from public.network_autopilot_config where scope = 'global' and key = 'monthly_article_budget_usd';

  if v_max_per_article is null or v_daily_cap is null or v_monthly_cap is null then
    return query select null::uuid, false, 'config_missing';
    return;
  end if;

  if p_estimated_usd > v_max_per_article then
    return query select null::uuid, false, 'estimate_exceeds_per_article_cap';
    return;
  end if;

  -- Sum spend from reservations that still count: reserved + consumed.
  -- Prefer actual_cost_usd when consumed, estimated_cost_usd otherwise.
  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0) into v_today
    from public.network_ai_budget_reservations
   where status in ('reserved', 'consumed')
     and created_at >= date_trunc('day', now());

  if v_today + p_estimated_usd > v_daily_cap then
    return query select null::uuid, false, 'daily_budget_exceeded';
    return;
  end if;

  select coalesce(sum(coalesce(actual_cost_usd, estimated_cost_usd)), 0) into v_month
    from public.network_ai_budget_reservations
   where status in ('reserved', 'consumed')
     and created_at >= date_trunc('month', now());

  if v_month + p_estimated_usd > v_monthly_cap then
    return query select null::uuid, false, 'monthly_budget_exceeded';
    return;
  end if;

  insert into public.network_ai_budget_reservations
    (autopilot_run_id, site_id, idea_id, estimated_cost_usd, status)
    values (p_autopilot_run_id, p_site_id, p_idea_id, p_estimated_usd, 'reserved')
    returning id into v_new_id;

  return query select v_new_id, true, null::text;
end $$;

create or replace function public.network_consume_ai_budget(
  p_reservation_id uuid,
  p_article_id     uuid,
  p_actual_usd     numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtextextended('network_autopilot_budget', 0);
  v_updated  integer;
begin
  perform pg_advisory_xact_lock(v_lock_key);
  update public.network_ai_budget_reservations
     set status        = 'consumed',
         article_id    = coalesce(p_article_id, article_id),
         actual_cost_usd = p_actual_usd,
         consumed_at   = now()
   where id = p_reservation_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

create or replace function public.network_release_ai_budget(
  p_reservation_id uuid,
  p_reason         text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtextextended('network_autopilot_budget', 0);
  v_updated  integer;
begin
  perform pg_advisory_xact_lock(v_lock_key);
  update public.network_ai_budget_reservations
     set status      = 'released',
         reason      = p_reason,
         released_at = now()
   where id = p_reservation_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

create or replace function public.network_fail_ai_budget(
  p_reservation_id uuid,
  p_reason         text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key bigint := hashtextextended('network_autopilot_budget', 0);
  v_updated  integer;
begin
  perform pg_advisory_xact_lock(v_lock_key);
  update public.network_ai_budget_reservations
     set status      = 'failed',
         reason      = p_reason,
         released_at = now()
   where id = p_reservation_id and status = 'reserved';
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end $$;

revoke all on function public.network_reserve_ai_budget(uuid, uuid, uuid, numeric) from public;
revoke all on function public.network_consume_ai_budget(uuid, uuid, numeric)       from public;
revoke all on function public.network_release_ai_budget(uuid, text)                from public;
revoke all on function public.network_fail_ai_budget(uuid, text)                   from public;

grant execute on function public.network_reserve_ai_budget(uuid, uuid, uuid, numeric) to authenticated, service_role;
grant execute on function public.network_consume_ai_budget(uuid, uuid, numeric)       to authenticated, service_role;
grant execute on function public.network_release_ai_budget(uuid, text)                to authenticated, service_role;
grant execute on function public.network_fail_ai_budget(uuid, text)                   to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 8. Seed default config (OFF everywhere)
-- ─────────────────────────────────────────────────────────────
--
-- All inserts use ON CONFLICT DO NOTHING so re-applying this
-- migration (or running it after an operator has edited values) is
-- a safe no-op.

insert into public.network_autopilot_config (scope, key, value, description) values
  ('global', 'autopilot_enabled',          'false'::jsonb,                          'Master switch — must be true for any autopilot run to proceed.'),
  ('global', 'auto_publish_enabled',       'false'::jsonb,                          'When false, approved articles stop at scheduled/review instead of auto-publishing.'),
  ('global', 'refreshes_enabled',          'true'::jsonb,                           'Allow autopilot to pick refreshes of existing articles over writing new ones.'),
  ('global', 'max_articles_per_day',       '1'::jsonb,                              'Hard ceiling on autopilot-produced articles per 24h.'),
  ('global', 'max_cost_per_article_usd',   '0.13'::jsonb,                           'Per-article AI spend cap (USD). Exceeding this holds the article.'),
  ('global', 'daily_article_budget_usd',   '0.50'::jsonb,                           'Rolling 24h network-wide spend cap (USD).'),
  ('global', 'monthly_article_budget_usd', '10.00'::jsonb,                          'Rolling month-to-date network-wide spend cap (USD).'),
  ('global', 'min_opportunity_score',      '60'::jsonb,                             'Opportunities scoring below this threshold never consume generation budget.'),
  ('global', 'default_draft_model',        '{"provider":"anthropic","model":"claude-haiku-4-5-20251001","max_output_tokens":4000}'::jsonb,
                                                                                     'Primary draft generation model. Haiku-first keeps cost under the per-article ceiling.'),
  ('global', 'fallback_model',             '{"provider":"anthropic","model":"claude-sonnet-4-6","max_output_tokens":4000}'::jsonb,
                                                                                     'Used only when deterministic checks say the draft is low-quality AND budget allows a retry.'),
  ('global', 'semantic_qa_model',          '{"provider":"anthropic","model":"claude-haiku-4-5-20251001","max_output_tokens":2000}'::jsonb,
                                                                                     'Optional one-shot QA pass. Skipped if the per-article ceiling would be exceeded.')
on conflict (scope, key) do nothing;

-- Per-site rows. YGO is the designated pilot; keep its enable flag
-- true so that when the operator flips global on, YGO alone starts
-- producing. Pokemon + MTG stay off because their publishing adapters
-- are not yet fully automatic. OnePiece + Lorcana are technically
-- publish-capable but held off during the pilot.
insert into public.network_autopilot_config (scope, key, value, description) values
  ('site:pokemon',  'enabled',               'false'::jsonb, 'Publishing adapter requires manual handoff; not yet auto-publish safe.'),
  ('site:pokemon',  'auto_publish_allowed',  'false'::jsonb, 'Hold until the pokeprices_external adapter is upgraded.'),
  ('site:mtg',      'enabled',               'false'::jsonb, 'Publishing adapter requires manual markdown commit; not yet auto-publish safe.'),
  ('site:mtg',      'auto_publish_allowed',  'false'::jsonb, 'Hold until the mtgprices_markdown adapter is upgraded.'),
  ('site:ygo',      'enabled',               'true'::jsonb,  'Designated pilot — fully auto-publish capable via ygo_db adapter.'),
  ('site:ygo',      'auto_publish_allowed',  'false'::jsonb, 'Still require master switch + explicit go-ahead for first paid run.'),
  ('site:onepiece', 'enabled',               'false'::jsonb, 'Publish-capable; held off during pilot.'),
  ('site:onepiece', 'auto_publish_allowed',  'false'::jsonb, 'Enable after YGO pilot proves cost + quality.'),
  ('site:lorcana',  'enabled',               'false'::jsonb, 'Publish-capable; held off during pilot.'),
  ('site:lorcana',  'auto_publish_allowed',  'false'::jsonb, 'Enable after YGO pilot proves cost + quality.')
on conflict (scope, key) do nothing;
