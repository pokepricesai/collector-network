-- =============================================================
-- Collector Network OS — Phase 1: Google ingestion + SEO + opps
-- =============================================================
--
-- Builds on Phase 0 to:
--   • persist the Google (GSC + GA4) property mapping per site
--   • store daily GSC + GA4 metrics in canonical, normalised tables
--   • back the executive dashboard and SEO command centre
--   • surface deterministic SEO Opportunities
--
-- Data layer (long-format, one row per (date, dimension-tuple)):
--
--   network_google_properties   — one row per (site_id, kind) with the
--                                 external property/stream identifiers
--   network_gsc_site_daily      — one row per (site_id, date)
--   network_gsc_url_daily       — one row per (site_id, date, page)
--   network_gsc_query_daily     — one row per (site_id, date, query)
--   network_gsc_url_query_daily — one row per (site_id, date, page, query)
--                                 — the raw feed the opportunity engine
--                                   consumes
--   network_ga4_site_daily      — one row per (site_id, date)
--   network_opportunities       — generated opportunities, deduped
--
-- Convention: metric values are stored RAW as returned by the source
-- API; computations (CTR, weighted-avg position) are done on read.
-- Position stored as the GSC daily figure (already impression-weighted
-- across hits inside the day), and when aggregating across days /
-- rows the caller does  sum(impressions*position) / sum(impressions).
--
-- Idempotency: all upserts collide on the natural key uniques. Safe
-- to re-run any backfill without duplication.

-- --- 1. Google property mapping ---------------------------------
--
-- One row per (site, kind). Kind distinguishes GSC siteUrl entries
-- ("sc-domain:…" or "https://…") from GA4 numeric property IDs.
-- `property_id` carries the raw identifier the respective API
-- requires on the wire.

create table if not exists public.network_google_properties (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.network_sites (id) on delete cascade,
  kind            text not null check (kind in ('gsc', 'ga4')),
  property_id     text not null,     -- 'sc-domain:…' | 'properties/…'
  display_name    text,
  measurement_id  text,              -- GA4 web stream, 'G-…', optional
  timezone        text,              -- GA4 property TZ, optional
  backfill_from   date,              -- earliest date to backfill
  backfill_through date,             -- last successful backfill date
  last_sync_at    timestamptz,
  last_data_date  date,              -- latest row we currently hold
  status          text not null default 'active'
                  check (status in ('active', 'paused', 'error')),
  config          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (site_id, kind)
);

create index if not exists network_google_properties_kind_idx
  on public.network_google_properties (kind, status);

-- --- 2. GSC site daily ------------------------------------------
create table if not exists public.network_gsc_site_daily (
  site_id       uuid not null references public.network_sites (id) on delete cascade,
  date          date not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  -- impression-weighted average position for the day across all URLs.
  position_avg  double precision,
  -- counts for "pages with impressions" and "pages with clicks" —
  -- cardinalities we need for the dashboard. Populated by the sync
  -- job from the url-level rows (see network_gsc_url_daily).
  pages_with_impressions integer not null default 0,
  pages_with_clicks      integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (site_id, date)
);

create index if not exists network_gsc_site_daily_date_idx
  on public.network_gsc_site_daily (date desc);

-- --- 3. GSC url daily -------------------------------------------
create table if not exists public.network_gsc_url_daily (
  site_id       uuid not null references public.network_sites (id) on delete cascade,
  date          date not null,
  page          text not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  position_avg  double precision,
  updated_at    timestamptz not null default now(),
  primary key (site_id, date, page)
);

create index if not exists network_gsc_url_daily_site_date_idx
  on public.network_gsc_url_daily (site_id, date desc);
create index if not exists network_gsc_url_daily_impressions_idx
  on public.network_gsc_url_daily (site_id, date desc, impressions desc);

-- --- 4. GSC query daily -----------------------------------------
create table if not exists public.network_gsc_query_daily (
  site_id       uuid not null references public.network_sites (id) on delete cascade,
  date          date not null,
  query         text not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  position_avg  double precision,
  updated_at    timestamptz not null default now(),
  primary key (site_id, date, query)
);

create index if not exists network_gsc_query_daily_site_date_idx
  on public.network_gsc_query_daily (site_id, date desc);
create index if not exists network_gsc_query_daily_impressions_idx
  on public.network_gsc_query_daily (site_id, date desc, impressions desc);

-- --- 5. GSC url+query daily -------------------------------------
--
-- The combo feed powers the opportunity engine. Deliberately
-- limited to a daily cap of 25000 rows per site (GSC rowLimit) to
-- keep volume manageable; opportunity rules work on 7/28-day
-- aggregates of this table.

create table if not exists public.network_gsc_url_query_daily (
  site_id       uuid not null references public.network_sites (id) on delete cascade,
  date          date not null,
  page          text not null,
  query         text not null,
  clicks        bigint not null default 0,
  impressions   bigint not null default 0,
  position_avg  double precision,
  updated_at    timestamptz not null default now(),
  primary key (site_id, date, page, query)
);

create index if not exists network_gsc_url_query_daily_site_date_idx
  on public.network_gsc_url_query_daily (site_id, date desc);

-- --- 6. GA4 site daily ------------------------------------------
create table if not exists public.network_ga4_site_daily (
  site_id                uuid not null references public.network_sites (id) on delete cascade,
  date                   date not null,
  active_users           bigint not null default 0,
  new_users              bigint not null default 0,
  sessions               bigint not null default 0,
  engaged_sessions       bigint not null default 0,
  avg_session_duration   double precision,
  screen_page_views      bigint not null default 0,
  updated_at             timestamptz not null default now(),
  primary key (site_id, date)
);

create index if not exists network_ga4_site_daily_date_idx
  on public.network_ga4_site_daily (date desc);

-- --- 7. Opportunities -------------------------------------------
--
-- Deduplication model: opportunities are regenerated nightly from
-- the latest 28-day aggregate. A unique (site_id, kind, page, query)
-- key means repeated runs of the same deterministic rule UPDATE the
-- existing opportunity rather than creating a new one.
--
-- Once Luke converts an opportunity to a task, `task_id` is set and
-- `status` flips to 'actioned'. Future runs with the same key
-- preserve that linkage via on-conflict-do-update exclusions.

create table if not exists public.network_opportunities (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.network_sites (id) on delete cascade,
  kind            text not null,           -- 'low_ctr' | 'striking_distance' | …
  severity        public.network_task_priority not null default 'normal',
  page            text not null default '',
  query           text not null default '',
  title           text not null,
  description     text,
  evidence        jsonb not null default '{}'::jsonb,
  metrics         jsonb not null default '{}'::jsonb,
  status          text not null default 'open'
                  check (status in ('open', 'actioned', 'dismissed', 'stale')),
  task_id         uuid references public.network_tasks (id) on delete set null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  dismissed_at    timestamptz,
  dismissed_by    uuid references public.network_admin_users (id) on delete set null,
  dismiss_reason  text,
  unique (site_id, kind, page, query)
);

create index if not exists network_opportunities_site_status_idx
  on public.network_opportunities (site_id, status, severity);
create index if not exists network_opportunities_kind_idx
  on public.network_opportunities (kind, status);

-- --- 8. Metric definitions: add page-cardinality metrics --------
insert into public.network_metric_definitions
  (code, display_name, unit, default_source, is_network, is_site)
values
  ('pages_with_impressions', 'Pages with impressions', 'count', 'gsc', true, true),
  ('pages_with_clicks',      'Pages with clicks',      'count', 'gsc', true, true)
on conflict (code) do nothing;

-- --- 9. RLS enablement + policies -------------------------------
alter table public.network_google_properties     enable row level security;
alter table public.network_gsc_site_daily        enable row level security;
alter table public.network_gsc_url_daily         enable row level security;
alter table public.network_gsc_query_daily       enable row level security;
alter table public.network_gsc_url_query_daily   enable row level security;
alter table public.network_ga4_site_daily        enable row level security;
alter table public.network_opportunities         enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_google_properties',
    'network_gsc_site_daily',
    'network_gsc_url_daily',
    'network_gsc_query_daily',
    'network_gsc_url_query_daily',
    'network_ga4_site_daily',
    'network_opportunities'
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

-- Service-role (used by cron sync routes) bypasses RLS by default.

-- Touch trigger on google_properties.
drop trigger if exists network_google_properties_touch on public.network_google_properties;
create trigger network_google_properties_touch
  before update on public.network_google_properties
  for each row execute function public.network_touch_updated_at();

-- --- 10. Seed property mapping ----------------------------------
--
-- IDs validated against the live SA (cn-os-analytics) on 2026-10-02.
-- GSC: all 5 are domain-level properties. GA4: all 5 are children
-- of account 387307504. Backfill-from set to each stream's create
-- time (approximate — the sync job clamps to the earliest date the
-- API returns data for).

do $$
declare
  v_pokemon  uuid;
  v_mtg      uuid;
  v_ygo      uuid;
  v_onepiece uuid;
  v_lorcana  uuid;
begin
  select id into v_pokemon  from public.network_sites where slug = 'pokemon';
  select id into v_mtg      from public.network_sites where slug = 'mtg';
  select id into v_ygo      from public.network_sites where slug = 'ygo';
  select id into v_onepiece from public.network_sites where slug = 'onepiece';
  select id into v_lorcana  from public.network_sites where slug = 'lorcana';

  -- GSC — all 5 are sc-domain properties, SA has siteRestrictedUser.
  insert into public.network_google_properties
    (site_id, kind, property_id, display_name, backfill_from, status)
  values
    (v_pokemon,  'gsc', 'sc-domain:pokeprices.io',     'PokePrices (sc-domain)',     '2026-03-10', 'active'),
    (v_mtg,      'gsc', 'sc-domain:mtgprices.io',      'MTGPrices (sc-domain)',      '2026-09-18', 'active'),
    (v_ygo,      'gsc', 'sc-domain:ygoprices.io',      'YGOPrices (sc-domain)',      '2026-10-01', 'active'),
    (v_onepiece, 'gsc', 'sc-domain:onepieceprices.io', 'OnePiecePrices (sc-domain)', '2026-10-01', 'active'),
    (v_lorcana,  'gsc', 'sc-domain:lorcanaprices.io',  'LorcanaPrices (sc-domain)',  '2026-10-01', 'active')
  on conflict (site_id, kind) do update
    set property_id   = excluded.property_id,
        display_name  = excluded.display_name,
        backfill_from = coalesce(public.network_google_properties.backfill_from, excluded.backfill_from),
        status        = 'active',
        updated_at    = now();

  -- GA4 — all 5 numeric properties. Measurement IDs cached for
  -- dashboard display; backfill_from = stream create date.
  insert into public.network_google_properties
    (site_id, kind, property_id, display_name, measurement_id, timezone, backfill_from, status)
  values
    (v_pokemon,  'ga4', 'properties/528046645', 'PokePrices',     'G-91WBNN7V11', 'Etc/GMT', '2026-03-12', 'active'),
    (v_mtg,      'ga4', 'properties/555167662', 'MTGPrices',      'G-LQ5L0E0VR2', 'Etc/GMT', '2026-09-21', 'active'),
    (v_ygo,      'ga4', 'properties/557073469', 'YGOPrices',      'G-B92P0W8GDQ', 'Etc/GMT', '2026-10-02', 'active'),
    (v_onepiece, 'ga4', 'properties/557176433', 'OnePiecePrices', 'G-7LK8B63F5B', 'Etc/GMT', '2026-10-02', 'active'),
    (v_lorcana,  'ga4', 'properties/557090978', 'LorcanaPrices',  'G-L5C90DTH97', 'Etc/GMT', '2026-10-02', 'active')
  on conflict (site_id, kind) do update
    set property_id    = excluded.property_id,
        display_name   = excluded.display_name,
        measurement_id = excluded.measurement_id,
        timezone       = excluded.timezone,
        backfill_from  = coalesce(public.network_google_properties.backfill_from, excluded.backfill_from),
        status         = 'active',
        updated_at     = now();
end $$;

-- Flip the integration cards for gsc + ga4 from 'not_connected' to
-- 'needs_configuration' — they are now configured server-side, but
-- the first successful sync will flip them to 'connected'. The
-- sync route updates last_success_at and status on completion.
update public.network_integrations
   set status = 'needs_configuration'::public.network_integration_status,
       updated_at = now()
 where provider in ('gsc', 'ga4')
   and status = 'not_connected';

-- --- 11. Dashboard helpers --------------------------------------
--
-- Convenience SQL functions the UI consumes. Keep them SQL-level so
-- the planner can inline them and the admin app does one round-trip
-- per range it wants.

create or replace function public.network_dashboard_sitelevel(
  p_start date,
  p_end   date
) returns table (
  site_id uuid,
  slug text,
  active_users bigint,
  sessions bigint,
  google_clicks bigint,
  google_impressions bigint,
  pages_with_impressions bigint,
  pages_with_clicks bigint,
  avg_position double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sites as (
    select id, slug from public.network_sites where status = 'active'
  ),
  ga as (
    select site_id,
           sum(active_users)::bigint as active_users,
           sum(sessions)::bigint     as sessions
      from public.network_ga4_site_daily
     where date between p_start and p_end
     group by site_id
  ),
  gsc as (
    select site_id,
           sum(clicks)::bigint          as clicks,
           sum(impressions)::bigint     as impressions,
           sum(pages_with_impressions)::bigint as pwi,
           sum(pages_with_clicks)::bigint      as pwc,
           case when sum(impressions) > 0
                then sum(impressions * position_avg) / sum(impressions)
                end as position_avg
      from public.network_gsc_site_daily
     where date between p_start and p_end
     group by site_id
  )
  select s.id, s.slug,
         coalesce(ga.active_users, 0),
         coalesce(ga.sessions, 0),
         coalesce(gsc.clicks, 0),
         coalesce(gsc.impressions, 0),
         coalesce(gsc.pwi, 0),
         coalesce(gsc.pwc, 0),
         gsc.position_avg
    from sites s
    left join ga   on ga.site_id  = s.id
    left join gsc  on gsc.site_id = s.id;
$$;

revoke all on function public.network_dashboard_sitelevel(date, date) from public;
grant execute on function public.network_dashboard_sitelevel(date, date)
  to authenticated, service_role;

-- Network-wide totals for a window.
create or replace function public.network_dashboard_total(
  p_start date,
  p_end   date
) returns table (
  active_users bigint,
  sessions bigint,
  google_clicks bigint,
  google_impressions bigint,
  pages_with_impressions bigint,
  pages_with_clicks bigint,
  avg_position double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ga as (
    select coalesce(sum(active_users), 0)::bigint as u,
           coalesce(sum(sessions), 0)::bigint     as s
      from public.network_ga4_site_daily
     where date between p_start and p_end
  ),
  gsc as (
    select coalesce(sum(clicks), 0)::bigint          as c,
           coalesce(sum(impressions), 0)::bigint     as i,
           coalesce(sum(pages_with_impressions), 0)::bigint as pwi,
           coalesce(sum(pages_with_clicks), 0)::bigint      as pwc,
           case when sum(impressions) > 0
                then sum(impressions * position_avg) / sum(impressions)
                end as position_avg
      from public.network_gsc_site_daily
     where date between p_start and p_end
  )
  select ga.u, ga.s,
         gsc.c, gsc.i, gsc.pwi, gsc.pwc, gsc.position_avg
    from ga, gsc;
$$;

revoke all on function public.network_dashboard_total(date, date) from public;
grant execute on function public.network_dashboard_total(date, date)
  to authenticated, service_role;
