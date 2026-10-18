-- =============================================================
-- PP-TCG-MIGRATE-01: TCGGraph provider ingestion schema
-- =============================================================
--
-- Separate from PokePrices' legacy `cards` + `card_trends` tables.
-- The migration path reads TCGGraph into these tables, then a
-- future Phase-8 flip switches public reads over.
--
-- All tables admin-only via public.network_is_admin() RLS.
-- Zero writes to public.cards / public.card_trends from this
-- migration. The legacy Python scraper that runs the GitHub Actions
-- nightly job at 08:00 UTC is unchanged.
--
-- Each monetary field keeps the provider's native currency so no
-- lossy conversions happen at write time. Rendering decides when to
-- convert.

-- -------------------------------------------------------------
-- 1. Provider card identities (TCG card + printing level)
-- -------------------------------------------------------------
-- One row per (tcg_card_id, tcg_printing_key). The `printings[]`
-- array on a TCGGraph card is expanded here so each physical
-- printing has its own row — this is what the PP mapping layer
-- points to via tcg_price_card_id + tcg_printing_key.

create table if not exists public.pokemon_tcg_provider_cards (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph' check (provider in ('tcggraph','justtcg')),
  tcg_card_id        text not null,
  tcg_printing_key   text not null,                      -- 'normal','1st-edition','shadowless', etc.
  tcg_set_code       text not null,
  tcg_set_name       text,
  tcg_language       text not null,                      -- 'en','ja','de','es','fr','it'
  tcg_card_name      text,
  tcg_collector_number text,
  tcg_rarity         text,
  base_card_id       text,                               -- for promo reprints linking to a base
  english_id         text,                               -- cross-language link
  image_small        text,
  image_normal       text,
  image_large        text,
  image_source       text,                               -- 'own' | 'card' | 'printing'
  price_status       text,                               -- 'priced' | 'unquoted' | 'unlisted'
  prices_updated_at  timestamptz,
  graded_updated_at  timestamptz,
  catalogue_version  text,
  ingested_at        timestamptz not null default now(),
  raw_payload        jsonb,                              -- full TCGGraph response for debugging
  unique (provider, tcg_card_id, tcg_printing_key)
);

create index if not exists pokemon_tcg_provider_cards_card_idx
  on public.pokemon_tcg_provider_cards (provider, tcg_card_id);
create index if not exists pokemon_tcg_provider_cards_set_idx
  on public.pokemon_tcg_provider_cards (tcg_set_code, tcg_language);

alter table public.pokemon_tcg_provider_cards enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_provider_cards') then
    create policy pokemon_tcg_provider_cards_admin on public.pokemon_tcg_provider_cards
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 2. Current market prices (TCGplayer, Cardmarket, Cardkingdom, Manapool)
-- -------------------------------------------------------------
-- One row per (card, printing, source, finish, listType). Finish
-- stays as the TCG value, not derived.

create table if not exists public.pokemon_tcg_prices_market (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph',
  tcg_card_id        text not null,
  tcg_printing_key   text not null,
  source             text not null check (source in ('tcgplayer','cardmarket','cardkingdom','manapool')),
  region             text,
  list_type          text not null default 'retail' check (list_type in ('retail','buylist')),
  finish             text,
  currency           text not null,
  market             numeric(14,4),
  low                numeric(14,4),
  trend              numeric(14,4),
  avg1               numeric(14,4),
  avg7               numeric(14,4),
  avg30              numeric(14,4),
  basis              text,
  source_updated_at  timestamptz,
  ingested_at        timestamptz not null default now(),
  unique (provider, tcg_card_id, tcg_printing_key, source, list_type, finish, currency)
);
create index if not exists pokemon_tcg_prices_market_card_idx
  on public.pokemon_tcg_prices_market (provider, tcg_card_id, tcg_printing_key);
alter table public.pokemon_tcg_prices_market enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_prices_market') then
    create policy pokemon_tcg_prices_market_admin on public.pokemon_tcg_prices_market
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 3. Current graded prices (per grader + grade; pooled 'any')
-- -------------------------------------------------------------
-- Pooled grade 7/8/9/9.5 are grader='any'. Per-grader fields only
-- exist for grade 10. Store the TCG value exactly as returned.

create table if not exists public.pokemon_tcg_prices_graded (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph',
  tcg_card_id        text not null,
  grader             text not null check (grader in ('raw','any','psa','bgs','cgc','sgc')),
  grade              text not null check (grade in ('ungraded','7','8','9','9.5','10')),
  currency           text not null,
  price              numeric(14,4),
  sales_volume       integer,
  source_updated_at  timestamptz,
  ingested_at        timestamptz not null default now(),
  unique (provider, tcg_card_id, grader, grade)
);
create index if not exists pokemon_tcg_prices_graded_card_idx
  on public.pokemon_tcg_prices_graded (provider, tcg_card_id);
alter table public.pokemon_tcg_prices_graded enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_prices_graded') then
    create policy pokemon_tcg_prices_graded_admin on public.pokemon_tcg_prices_graded
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 4. Historical price points
-- -------------------------------------------------------------
-- Daily series from /v1/prices/{id}/history. Supports market or
-- graded series — the shape (grader + grade) or (source + finish)
-- tells you which. All stored at daily granularity.

create table if not exists public.pokemon_tcg_prices_history (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph',
  tcg_card_id        text not null,
  tcg_printing_key   text,
  series_kind        text not null check (series_kind in ('market','graded')),
  source             text,                               -- market only
  finish             text,                               -- market only
  grader             text,                               -- graded only
  grade              text,                               -- graded only
  currency           text not null,
  day                date not null,
  market             numeric(14,4),
  low                numeric(14,4),
  ingested_at        timestamptz not null default now(),
  unique (provider, tcg_card_id, tcg_printing_key, series_kind, source, finish, grader, grade, day)
);
create index if not exists pokemon_tcg_prices_history_card_day_idx
  on public.pokemon_tcg_prices_history (provider, tcg_card_id, day desc);
alter table public.pokemon_tcg_prices_history enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_prices_history') then
    create policy pokemon_tcg_prices_history_admin on public.pokemon_tcg_prices_history
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 5. Observed set catalogues (for new-set discovery)
-- -------------------------------------------------------------
-- Snapshot of /v1/sets?game=pokemon&language=X responses on each
-- discovery run. Diffs produce rows in pokemon_tcg_set_alerts.

create table if not exists public.pokemon_tcg_sets_observed (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph',
  tcg_set_code       text not null,
  tcg_set_name       text not null,
  tcg_language       text not null,
  released_at        date,
  card_count         integer,
  printing_count     integer,
  observed_at        timestamptz not null default now(),
  unique (provider, tcg_set_code, observed_at)
);
create index if not exists pokemon_tcg_sets_observed_latest_idx
  on public.pokemon_tcg_sets_observed (provider, tcg_set_code, observed_at desc);
alter table public.pokemon_tcg_sets_observed enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_sets_observed') then
    create policy pokemon_tcg_sets_observed_admin on public.pokemon_tcg_sets_observed
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 6. New-set alerts
-- -------------------------------------------------------------

create table if not exists public.pokemon_tcg_set_alerts (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'tcggraph',
  kind               text not null check (kind in ('new_set','card_count_changed','release_date_changed')),
  tcg_set_code       text not null,
  tcg_set_name       text,
  tcg_language       text,
  payload            jsonb not null default '{}'::jsonb,
  first_seen_at      timestamptz not null default now(),
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references auth.users(id) on delete set null,
  acknowledged_display text
);
create index if not exists pokemon_tcg_set_alerts_open_idx
  on public.pokemon_tcg_set_alerts (acknowledged_at nulls first, first_seen_at desc);
alter table public.pokemon_tcg_set_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_set_alerts') then
    create policy pokemon_tcg_set_alerts_admin on public.pokemon_tcg_set_alerts
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 7. Ingestion runs (operational log + credit tracking)
-- -------------------------------------------------------------

create table if not exists public.pokemon_tcg_ingestion_runs (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('full_catalogue','set_discovery','history_batch','repair')),
  provider           text not null default 'tcggraph',
  pp_language        text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  state              text not null default 'running' check (state in ('running','completed','failed','cancelled')),
  credits_spent      integer not null default 0,
  requests_made      integer not null default 0,
  cards_ingested     integer not null default 0,
  prices_market_rows integer not null default 0,
  prices_graded_rows integer not null default 0,
  sets_observed      integer not null default 0,
  alerts_opened      integer not null default 0,
  error_message      text,
  metadata           jsonb not null default '{}'::jsonb
);
create index if not exists pokemon_tcg_ingestion_runs_recent_idx
  on public.pokemon_tcg_ingestion_runs (started_at desc);
alter table public.pokemon_tcg_ingestion_runs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='pokemon_tcg_ingestion_runs') then
    create policy pokemon_tcg_ingestion_runs_admin on public.pokemon_tcg_ingestion_runs
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- -------------------------------------------------------------
-- 8. Deprecate the Phase-8 placeholder from 01A
-- -------------------------------------------------------------
-- pokemon_tcg_price_snapshots was created as a flat Phase-8 shape
-- that doesn't accommodate per-source + per-finish + per-grade
-- separation. We leave the empty table in place for now (nothing
-- reads it) and route new ingestion into the normalised tables
-- above.

comment on table public.pokemon_tcg_price_snapshots is
  'DEPRECATED by PP-TCG-MIGRATE-01. Replaced by pokemon_tcg_provider_cards + pokemon_tcg_prices_market + pokemon_tcg_prices_graded + pokemon_tcg_prices_history. Kept for now; drop in a later migration once no code references it.';

-- End of migration. Zero touch on cards / card_trends / public
-- pricing. No cut-over logic in this migration.
