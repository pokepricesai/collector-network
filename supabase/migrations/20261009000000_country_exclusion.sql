-- Global reporting-traffic Singapore exclusion.
--
-- Principle: RAW GA4 DATA IS NEVER MODIFIED. We add a country-
-- dimensioned daily table alongside the existing network_ga4_site_daily,
-- and a SQL function that returns reporting totals = raw country
-- aggregate minus configured excluded_countries.
--
-- Config lives in network_settings as scope-null (network-wide), key
-- 'reporting.excluded_countries', value JSONB array of ISO country
-- names as reported by the GA4 "country" dimension (e.g. 'Singapore').
--
-- Fallback behaviour: for dates where the country breakdown table has
-- no rows yet (pre-migration history or ingestion gaps), the function
-- returns the unfiltered network_ga4_site_daily totals and flags the
-- date as `country_coverage='unfiltered'`. This keeps dashboards
-- intact while the backfill catches up.

-- ─── 1. Country-dimensioned daily table ─────────────────────────

create table if not exists public.network_ga4_country_daily (
  site_id              uuid not null references public.network_sites (id) on delete cascade,
  date                 date not null,
  country              text not null,           -- as reported by GA4 "country" dimension ('Singapore', 'United States', ...)
  active_users         bigint not null default 0,
  new_users            bigint not null default 0,
  sessions             bigint not null default 0,
  engaged_sessions     bigint not null default 0,
  screen_page_views    bigint not null default 0,
  updated_at           timestamptz not null default now(),
  primary key (site_id, date, country)
);

create index if not exists network_ga4_country_daily_date_idx
  on public.network_ga4_country_daily (date desc, site_id);
create index if not exists network_ga4_country_daily_country_idx
  on public.network_ga4_country_daily (country, date desc);

alter table public.network_ga4_country_daily enable row level security;

drop policy if exists network_ga4_country_daily_admin_read on public.network_ga4_country_daily;
create policy network_ga4_country_daily_admin_read on public.network_ga4_country_daily
  for select
  using (
    exists (
      select 1 from public.network_admin_users
      where network_admin_users.auth_user_id = auth.uid()
    )
  );
grant select on public.network_ga4_country_daily to authenticated;
grant all    on public.network_ga4_country_daily to service_role;

comment on table public.network_ga4_country_daily is
  'GA4 traffic broken down by country. Raw per-country rows preserved; downstream reporting layer excludes configured countries. Never mutated except by the GA4 country ingest.';

-- ─── 2. Reporting config default ────────────────────────────────

-- Insert the default excluded-countries setting unless already present.
-- Site_id null = network-wide default. Site-scoped overrides can be
-- added later by inserting rows with site_id set.
insert into public.network_settings (site_id, key, value, description)
select null, 'reporting.excluded_countries', '["Singapore"]'::jsonb,
       'Countries excluded from REPORTING traffic denominators (users / sessions / pageviews). Raw GA4 data is preserved; this filter applies only to operational dashboards + intelligence rules. GSC search data is NOT affected.'
where not exists (
  select 1 from public.network_settings where key = 'reporting.excluded_countries' and site_id is null
);

-- ─── 3. Reporting-traffic SQL function ──────────────────────────
--
-- SECURITY DEFINER: lets dashboard RPCs call this uniformly from the
-- authenticated role. Returns a per-day summary already excluding
-- configured countries, with a coverage flag so the UI can tell
-- "filtered" from "unfiltered fallback" rows apart.

create or replace function public.network_reporting_traffic(
  p_site_id uuid,
  p_start   date,
  p_end     date
)
returns table (
  date                 date,
  active_users         bigint,
  new_users            bigint,
  sessions             bigint,
  engaged_sessions     bigint,
  screen_page_views    bigint,
  raw_active_users     bigint,     -- unfiltered total for the day (sanity)
  excluded_users       bigint,     -- active_users excluded this day
  country_coverage     text        -- 'filtered' | 'unfiltered_fallback'
)
language sql
security definer
set search_path = public
as $$
  with cfg as (
    -- Expand the jsonb array into a set of text rows. Falls back to
    -- the hard-coded default when the setting row is missing.
    select coalesce(c.country, 'Singapore') as country
    from (
      select jsonb_array_elements_text(value) as country
      from public.network_settings
      where key = 'reporting.excluded_countries' and site_id is null
    ) c
    union all
    select 'Singapore'
    where not exists (
      select 1 from public.network_settings
      where key = 'reporting.excluded_countries' and site_id is null
    )
  ),
  per_country as (
    select
      c.date,
      c.country,
      c.active_users,
      c.new_users,
      c.sessions,
      c.engaged_sessions,
      c.screen_page_views,
      (c.country in (select country from cfg)) as is_excluded
    from public.network_ga4_country_daily c
    where (p_site_id is null or c.site_id = p_site_id)
      and c.date >= p_start
      and c.date <= p_end
  ),
  per_day as (
    select
      pc.date,
      sum(case when pc.is_excluded then 0 else pc.active_users      end)::bigint as active_users,
      sum(case when pc.is_excluded then 0 else pc.new_users          end)::bigint as new_users,
      sum(case when pc.is_excluded then 0 else pc.sessions           end)::bigint as sessions,
      sum(case when pc.is_excluded then 0 else pc.engaged_sessions   end)::bigint as engaged_sessions,
      sum(case when pc.is_excluded then 0 else pc.screen_page_views  end)::bigint as screen_page_views,
      sum(pc.active_users)::bigint  as raw_active_users,
      sum(case when pc.is_excluded then pc.active_users else 0       end)::bigint as excluded_users
    from per_country pc
    group by pc.date
  ),
  fallback_days as (
    select
      s.date,
      s.active_users::bigint,
      s.new_users::bigint,
      s.sessions::bigint,
      s.engaged_sessions::bigint,
      s.screen_page_views::bigint,
      s.active_users::bigint as raw_active_users,
      0::bigint              as excluded_users
    from public.network_ga4_site_daily s
    where (p_site_id is null or s.site_id = p_site_id)
      and s.date >= p_start
      and s.date <= p_end
      and not exists (
        select 1 from per_day pd where pd.date = s.date
      )
  )
  select
    date,
    active_users,
    new_users,
    sessions,
    engaged_sessions,
    screen_page_views,
    raw_active_users,
    excluded_users,
    'filtered'::text as country_coverage
  from per_day
  union all
  select
    date,
    active_users,
    new_users,
    sessions,
    engaged_sessions,
    screen_page_views,
    raw_active_users,
    excluded_users,
    'unfiltered_fallback'::text as country_coverage
  from fallback_days
  order by date;
$$;

grant execute on function public.network_reporting_traffic(uuid, date, date) to authenticated, service_role;
comment on function public.network_reporting_traffic(uuid, date, date) is
  'Reporting-traffic per day: country-breakdown rows minus configured excluded_countries. Falls back to raw network_ga4_site_daily totals for dates with no country data yet (country_coverage=unfiltered_fallback).';
