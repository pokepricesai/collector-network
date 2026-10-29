-- CN-05 Growth Intelligence · TCG Release Tracker
--
-- Cross-TCG release calendar. One row per announced release
-- (expansion, booster, deck, special collection). Covers all five
-- OS sites and preserves the regional / language distinction the
-- brief specifies (an English and Japanese version of the same
-- franchise's expansion are DIFFERENT rows, with their own dates
-- and sources).
--
-- Automation posture:
--   * v1 is MANUAL-CURATION-FIRST. Each row carries source_url,
--     source_verified_at and a verification_mode = 'manual'. The
--     daily sweep job touches status transitions only (released
--     when the date passes). It does NOT scrape publisher pages
--     — the brief explicitly forbids that unless the source has a
--     machine-readable feed and permissive terms.
--   * verification_mode 'automated' is reserved for future sources
--     where we add structured feeds (Scryfall for MTG, publisher
--     JSON feeds where legal). Not populated in v1.
--
-- Lifecycle:
--   confirmation_status = 'confirmed' | 'announced_tbc' | 'rumoured'
--                       | 'postponed' | 'released' | 'cancelled'
--   release_date_precision = 'day' | 'month' | 'tbc'
--     — never render a day when only a month is known.
--
-- Readiness is a derived field — the intelligence detector reads
-- the row + site set catalog state to decide whether a preparation
-- task is needed. We don't store readiness here; derivation stays
-- stateless.

create table if not exists public.network_tcg_releases (
  id                      uuid primary key default gen_random_uuid(),
  -- Which TCG franchise + which network site this belongs to.
  tcg                     text not null
                          check (tcg in ('pokemon','mtg','ygo','onepiece','lorcana')),
  site_slug               text not null
                          check (site_slug in ('pokemon','mtg','ygo','onepiece','lorcana')),
  -- Set name as published by the official source. Keep it UTF-8;
  -- the brief wants original-language names preserved alongside
  -- a translation.
  set_name                text not null,
  set_name_original       text,
  set_name_translated     text,
  translation_official    boolean not null default false,
  set_code                text,
  product_type            text not null default 'expansion'
                          check (product_type in (
                            'expansion','booster','starter_deck','structure_deck',
                            'special_collection','premium','promo','other'
                          )),
  language                text not null default 'en'
                          check (language in ('en','ja','other')),
  region                  text,
  release_date            date,
  release_date_precision  text not null default 'day'
                          check (release_date_precision in ('day','month','tbc')),
  prerelease_date         date,
  confirmation_status     text not null default 'confirmed'
                          check (confirmation_status in (
                            'confirmed','announced_tbc','rumoured',
                            'postponed','released','cancelled'
                          )),
  source_url              text,
  -- Human-readable notes (what source, what's uncertain, etc.).
  source_notes            text,
  source_verified_at      timestamptz,
  verification_mode       text not null default 'manual'
                          check (verification_mode in ('manual','automated')),
  -- Where this release is covered on-site (if applicable). Points
  -- at an existing public set page URL so the readiness detector
  -- can compare quickly.
  site_set_url            text,
  -- Change audit — latest previous release_date and the day it
  -- changed. For the "date changed" notification. Older history
  -- lives in metadata.date_history[] JSON array.
  previous_release_date   date,
  date_changed_at         timestamptz,
  -- Operator notes / internal flags.
  metadata                jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references public.network_admin_users (id) on delete set null,
  updated_by              uuid references public.network_admin_users (id) on delete set null,
  unique (tcg, set_code, language) deferrable initially deferred
);

-- Fast calendar lookup by date range + status.
create index if not exists network_tcg_releases_date_idx
  on public.network_tcg_releases (release_date, confirmation_status);
create index if not exists network_tcg_releases_site_date_idx
  on public.network_tcg_releases (site_slug, release_date desc);
create index if not exists network_tcg_releases_tcg_language_idx
  on public.network_tcg_releases (tcg, language, release_date);

-- Change log — one row per release_date change. Preserves the
-- audit trail without exploding the main table.
create table if not exists public.network_tcg_release_changes (
  id                      uuid primary key default gen_random_uuid(),
  release_id              uuid not null references public.network_tcg_releases (id) on delete cascade,
  changed_at              timestamptz not null default now(),
  change_type             text not null
                          check (change_type in (
                            'date_changed','status_changed','source_updated',
                            'readiness_action_created'
                          )),
  previous_value          jsonb,
  new_value               jsonb,
  changed_by              uuid references public.network_admin_users (id) on delete set null,
  change_source           text not null default 'operator'
                          check (change_source in ('operator','daily_sweep','ingestion'))
);
create index if not exists network_tcg_release_changes_release_idx
  on public.network_tcg_release_changes (release_id, changed_at desc);

-- RLS policies: admin-only. Mirrors the standard CN-OS pattern.
alter table public.network_tcg_releases enable row level security;
alter table public.network_tcg_release_changes enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array['network_tcg_releases','network_tcg_release_changes']) loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.network_is_admin())', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- updated_at trigger.
create or replace function public.network_tcg_releases_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists network_tcg_releases_touch on public.network_tcg_releases;
create trigger network_tcg_releases_touch
  before update on public.network_tcg_releases
  for each row execute function public.network_tcg_releases_touch_updated_at();

notify pgrst, 'reload schema';
