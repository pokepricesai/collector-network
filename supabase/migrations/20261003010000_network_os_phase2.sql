-- =============================================================
-- Collector Network OS — Phase 2: SEO intelligence operating layer
-- =============================================================
--
-- Builds on Phase 1 to turn analytics + opportunities into an
-- actual SEO operating intelligence system:
--
--   • Sitemap monitoring  (snapshots + issues)
--   • Indexing visibility (URL Inspection queue + cached results)
--   • SEO change tracker  (deployable change log + before/after)
--   • Experiment foundation (manual-first)
--   • Internal-link engine (orphan / weak / entity-related)
--   • Page-opportunity engine (which site templates we could build)
--   • Cannibalisation + content-gap findings (BigQuery-fed)
--   • BigQuery integration + readiness tracker for the other 4 sites
--
-- Convention: everything site-scoped joins public.network_sites.
-- All new tables are admin-RLS via public.network_is_admin().

-- --- 1. Sitemap snapshots ----------------------------------------
--
-- One row per (site, snapshot_at). We never store every URL every
-- day — that explodes. Instead each run records the submitted
-- URL count, the sampled valid count (we spot-check a bounded
-- fraction), and a hash of the sitemap structure (root + children
-- list) so repeat snapshots can be deduped if nothing changed.

create table if not exists public.network_sitemap_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  snapshot_at        timestamptz not null default now(),
  root_url           text not null,
  root_status        integer,                       -- HTTP status
  root_bytes         integer,
  shard_count        integer not null default 0,
  submitted_count    integer not null default 0,    -- urls declared by sitemap
  valid_sampled      integer not null default 0,    -- urls sampled + confirmed 2xx
  issue_count        integer not null default 0,
  structure_hash     text not null,                 -- hash(root + shard order + shard url counts)
  status             text not null default 'ok'
                     check (status in ('ok', 'warning', 'error')),
  error_summary      text,
  metadata           jsonb not null default '{}'::jsonb
);

create index if not exists network_sitemap_snapshots_site_at_idx
  on public.network_sitemap_snapshots (site_id, snapshot_at desc);

-- --- 2. Sitemap issues -------------------------------------------
--
-- Each row = one sitemap-shaped problem. url null means the issue
-- is sitemap-level (shard 500ing, root 404, etc).
--
-- issue_type: 'shard_http_error' | 'url_http_error' | 'redirects'
--           | 'noindex_in_sitemap' | 'canonical_mismatch'
--           | 'wrong_host' | 'duplicate_url' | 'empty_shard'
--           | 'parse_error' | 'orphan_shard'

create table if not exists public.network_sitemap_issues (
  id                 uuid primary key default gen_random_uuid(),
  snapshot_id        uuid references public.network_sitemap_snapshots (id) on delete cascade,
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  issue_type         text not null,
  severity           text not null default 'warning'
                     check (severity in ('info', 'warning', 'error')),
  url                text,
  shard_url          text,
  http_status        integer,
  detail             text,
  evidence           jsonb not null default '{}'::jsonb,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  resolved_at        timestamptz
);

create index if not exists network_sitemap_issues_site_type_idx
  on public.network_sitemap_issues (site_id, issue_type);
create index if not exists network_sitemap_issues_unresolved_idx
  on public.network_sitemap_issues (site_id, severity)
  where resolved_at is null;

-- --- 3. URL inspection cache + queue -----------------------------
--
-- The URL Inspection API has a strict daily quota (~2000/day per
-- property). We treat it as a cache: never re-inspect something we
-- inspected recently unless we have reason to. The queue carries
-- priority + reason; the runner picks the top of the queue each
-- scheduled run and persists results into network_url_inspections.

create table if not exists public.network_url_inspections (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  url                text not null,
  inspection_status  text not null default 'unknown'
                     check (inspection_status in ('inspected', 'quota_exceeded', 'error', 'unknown')),
  coverage_state     text,                 -- GSC verdict + coverage summary
  google_canonical   text,
  user_canonical     text,
  last_crawl_time    timestamptz,
  robots_state       text,
  indexing_state     text,                 -- 'INDEXING_ALLOWED' etc.
  verdict            text,                 -- 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL'
  http_status_code   integer,
  last_inspected_at  timestamptz,
  next_inspection_at timestamptz,
  evidence           jsonb not null default '{}'::jsonb,
  updated_at         timestamptz not null default now(),
  unique (site_id, url)
);

create index if not exists network_url_inspections_site_state_idx
  on public.network_url_inspections (site_id, coverage_state);
create index if not exists network_url_inspections_next_idx
  on public.network_url_inspections (next_inspection_at)
  where next_inspection_at is not null;

create table if not exists public.network_url_inspection_queue (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  url                text not null,
  priority           public.network_task_priority not null default 'normal',
  reason             text not null,                 -- 'new_sitemap_url' | 'opportunity' | 'manual' | ...
  requested_at       timestamptz not null default now(),
  attempted_at       timestamptz,
  status             text not null default 'pending'
                     check (status in ('pending', 'done', 'failed', 'skipped')),
  metadata           jsonb not null default '{}'::jsonb,
  unique (site_id, url)
);

create index if not exists network_url_inspection_queue_pending_idx
  on public.network_url_inspection_queue (site_id, priority)
  where status = 'pending';

-- --- 4. SEO changes ---------------------------------------------
--
-- Records SEO-impacting deployments / content edits for the
-- change-tracker. source: 'manual' | 'ai' | 'ci' | 'cms' | 'deploy'.
-- url_pattern lets a single change cover a template (/cards/*).

create table if not exists public.network_seo_changes (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  change_type        text not null,
  title              text not null,
  description        text,
  url_pattern        text,                 -- '/cards/*' or null
  url                text,                 -- single-URL changes
  old_value          text,
  new_value          text,
  commit_sha         text,
  source             text not null default 'manual',
  actor              text,                 -- free-text actor identifier
  actor_user_id      uuid references public.network_admin_users (id) on delete set null,
  started_at         timestamptz not null default now(),
  deployed_at        timestamptz,
  measurement_start  date,                 -- date to use for post-change window
  status             text not null default 'proposed'
                     check (status in ('proposed', 'deployed', 'measuring',
                                       'completed', 'rolled_back', 'cancelled')),
  evidence           jsonb not null default '{}'::jsonb,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists network_seo_changes_site_status_idx
  on public.network_seo_changes (site_id, status);
create index if not exists network_seo_changes_deployed_idx
  on public.network_seo_changes (deployed_at desc)
  where deployed_at is not null;

-- --- 5. Experiments ----------------------------------------------
--
-- Minimal foundation. We don't do stats inference yet; this is a
-- structured log for Luke/AI to look at later.

create table if not exists public.network_experiments (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  name               text not null,
  hypothesis         text,
  control_definition text,                 -- "pages matching /cards/* except /cards/promo/*"
  changed_pages      text[] not null default '{}',
  change_id          uuid references public.network_seo_changes (id) on delete set null,
  start_date         date,
  end_date           date,
  metrics            jsonb not null default '{}'::jsonb,
  status             text not null default 'planning'
                     check (status in ('planning', 'running', 'completed',
                                       'inconclusive', 'cancelled')),
  result_notes       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists network_experiments_site_status_idx
  on public.network_experiments (site_id, status);

-- --- 6. Internal-link opportunities ------------------------------

create table if not exists public.network_internal_link_opportunities (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  source_url         text not null,
  target_url         text not null,
  reason             text not null,                 -- 'orphan' | 'weakly_linked' | ...
  relationship       text,                          -- 'card->set' | 'set->card' | ...
  confidence         text not null default 'medium'
                     check (confidence in ('low', 'medium', 'high')),
  priority           public.network_task_priority not null default 'normal',
  evidence           jsonb not null default '{}'::jsonb,
  status             text not null default 'open'
                     check (status in ('open', 'actioned', 'dismissed', 'stale')),
  task_id            uuid references public.network_tasks (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  dismissed_at       timestamptz,
  unique (site_id, source_url, target_url, reason)
);

create index if not exists network_internal_link_opps_site_status_idx
  on public.network_internal_link_opportunities (site_id, status, priority);

-- --- 7. Page opportunities (templates we could build) -----------

create table if not exists public.network_page_opportunities (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  kind               text not null,                 -- 'species_pages' | 'artist_pages' | ...
  template_label     text not null,                 -- human-facing name
  reason             text not null,
  priority           public.network_task_priority not null default 'normal',
  available_count    integer not null default 0,    -- how many pages this would spawn
  gsc_impressions_28d bigint not null default 0,    -- GSC demand evidence
  gsc_clicks_28d     bigint not null default 0,
  related_queries    text[] not null default '{}',
  evidence           jsonb not null default '{}'::jsonb,
  build_status       text not null default 'proposed'
                     check (build_status in ('proposed', 'planned', 'building',
                                             'live', 'dismissed')),
  status             text not null default 'open'
                     check (status in ('open', 'actioned', 'dismissed', 'stale')),
  task_id            uuid references public.network_tasks (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (site_id, kind, template_label)
);

create index if not exists network_page_opps_site_status_idx
  on public.network_page_opportunities (site_id, status, priority);

-- --- 8. Cannibalisation findings --------------------------------
--
-- Deterministic output from the BigQuery/GSC analysis. Each row
-- is a (site, query) with >1 URL materially participating.

create table if not exists public.network_cannibalization_findings (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  query              text not null,
  url_count          integer not null,
  total_impressions  bigint not null,
  total_clicks       bigint not null,
  urls               jsonb not null default '[]'::jsonb,  -- [{url,imp,clicks,pos}]
  severity           public.network_task_priority not null default 'normal',
  status             text not null default 'open'
                     check (status in ('open', 'actioned', 'dismissed', 'stale')),
  task_id            uuid references public.network_tasks (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (site_id, query)
);

create index if not exists network_cannibalization_site_status_idx
  on public.network_cannibalization_findings (site_id, status, severity);

-- --- 9. Content gap findings ------------------------------------
--
-- Queries where the site has impressions but no obvious dedicated
-- page, OR the ranking page is weakly matched.

create table if not exists public.network_content_gap_findings (
  id                 uuid primary key default gen_random_uuid(),
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  query              text not null,
  ranking_url        text,
  impressions_28d    bigint not null,
  clicks_28d         bigint not null,
  position_28d       double precision,
  gap_reason         text not null,                 -- 'no_dedicated_page' | 'weak_match' | 'rising_demand'
  evidence           jsonb not null default '{}'::jsonb,
  severity           public.network_task_priority not null default 'normal',
  status             text not null default 'open'
                     check (status in ('open', 'actioned', 'dismissed', 'stale')),
  task_id            uuid references public.network_tasks (id) on delete set null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  unique (site_id, query)
);

create index if not exists network_content_gap_site_status_idx
  on public.network_content_gap_findings (site_id, status, severity);

-- --- 10. BigQuery readiness per site ----------------------------
--
-- Tracks GA4 BigQuery Export + GSC Bulk Export configuration for
-- each of the five sites. Only PokePrices has it in Phase 2; the
-- other four sit as 'not_configured'.

create table if not exists public.network_bigquery_readiness (
  id                     uuid primary key default gen_random_uuid(),
  site_id                uuid not null unique references public.network_sites (id) on delete cascade,
  gcp_project_id         text,
  gsc_dataset            text,
  gsc_export_status      text not null default 'not_configured'
                         check (gsc_export_status in ('not_configured', 'configuring',
                                                      'connected', 'error')),
  gsc_last_export_date   date,
  ga4_dataset            text,
  ga4_export_status      text not null default 'not_configured'
                         check (ga4_export_status in ('not_configured', 'configuring',
                                                      'connected', 'error')),
  ga4_last_export_date   date,
  last_checked_at        timestamptz,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- --- 11. Daily brief snapshot (optional cache) ------------------
--
-- Stores a daily persisted brief for /admin/brief so page loads
-- are instant and we have a replayable history for audits.

create table if not exists public.network_daily_briefs (
  id                 uuid primary key default gen_random_uuid(),
  for_date           date not null unique,
  payload            jsonb not null,
  generated_at       timestamptz not null default now()
);

-- --- 12. RLS enablement + admin-only policies -------------------
alter table public.network_sitemap_snapshots              enable row level security;
alter table public.network_sitemap_issues                 enable row level security;
alter table public.network_url_inspections                enable row level security;
alter table public.network_url_inspection_queue           enable row level security;
alter table public.network_seo_changes                    enable row level security;
alter table public.network_experiments                    enable row level security;
alter table public.network_internal_link_opportunities    enable row level security;
alter table public.network_page_opportunities             enable row level security;
alter table public.network_cannibalization_findings       enable row level security;
alter table public.network_content_gap_findings           enable row level security;
alter table public.network_bigquery_readiness             enable row level security;
alter table public.network_daily_briefs                   enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_sitemap_snapshots',
    'network_sitemap_issues',
    'network_url_inspections',
    'network_url_inspection_queue',
    'network_seo_changes',
    'network_experiments',
    'network_internal_link_opportunities',
    'network_page_opportunities',
    'network_cannibalization_findings',
    'network_content_gap_findings',
    'network_bigquery_readiness',
    'network_daily_briefs'
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

-- Touch triggers for mutable tables.
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_url_inspections',
    'network_seo_changes',
    'network_experiments',
    'network_bigquery_readiness'
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

-- --- 13. BigQuery data source + integration row ----------------

insert into public.network_data_sources (code, display_name, category, description)
values
  ('bigquery', 'BigQuery (PokePrices export)', 'external', 'Google BigQuery, PokePrices GSC bulk + GA4 export datasets')
on conflict (code) do nothing;

insert into public.network_integrations (provider, site_id, status)
select 'bigquery', s.id, 'not_connected'::public.network_integration_status
  from public.network_sites s
 where s.slug = 'pokemon'
on conflict (provider, site_id) do nothing;

insert into public.network_integrations (provider, site_id, status)
values ('bigquery', null, 'not_connected')
on conflict (provider, site_id) do nothing;

-- --- 14. BigQuery readiness seed ------------------------------

do $$
declare
  r record;
begin
  for r in select id, slug from public.network_sites loop
    insert into public.network_bigquery_readiness
      (site_id, gcp_project_id, gsc_dataset, ga4_dataset, notes)
    values
      (r.id,
       case when r.slug = 'pokemon' then 'pokeprices-seo' else null end,
       case when r.slug = 'pokemon' then 'searchconsole' else null end,
       case when r.slug = 'pokemon' then 'analytics_528046645' else null end,
       case when r.slug = 'pokemon' then
         'GSC Bulk Export + GA4 BigQuery Export already configured; CN SA granted bigquery.jobUser + dataViewer on 2026-10-03.'
       else
         'GSC Bulk Export + GA4 BigQuery Export not yet configured.' end)
    on conflict (site_id) do nothing;
  end loop;
end $$;

-- Flip the PokePrices BigQuery integration to needs_configuration
-- (the first successful sync flips it to connected).
update public.network_integrations
   set status = 'needs_configuration'::public.network_integration_status,
       updated_at = now()
 where provider = 'bigquery'
   and status = 'not_connected';

-- --- 15. SEO change deployed_at touch ------------------------

create or replace function public.network_seo_change_deploy_touch()
returns trigger
language plpgsql
as $$
begin
  -- When status flips to 'deployed', stamp deployed_at + measurement_start
  if new.status = 'deployed' and old.status is distinct from 'deployed' then
    if new.deployed_at is null then new.deployed_at = now(); end if;
    if new.measurement_start is null then new.measurement_start = (now() at time zone 'UTC')::date; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists network_seo_changes_deploy_touch on public.network_seo_changes;
create trigger network_seo_changes_deploy_touch
  before update on public.network_seo_changes
  for each row execute function public.network_seo_change_deploy_touch();

-- --- 16. SEO change before/after helper ---------------------
--
-- Returns 28d/7d GSC rollups for the pages targeted by a change,
-- split by "before" and "after" the measurement_start date. The
-- SQL is deliberately a single statement so one round-trip powers
-- the admin view.

create or replace function public.network_seo_change_performance(
  p_change_id uuid
) returns table (
  period            text,
  clicks            bigint,
  impressions       bigint,
  position_avg      double precision,
  ga4_users         bigint,
  ga4_sessions      bigint,
  window_start      date,
  window_end        date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_site_id uuid;
  v_url     text;
  v_pattern text;
  v_start   date;
  v_before_end   date;
  v_before_start date;
  v_after_end    date;
begin
  select site_id, url, url_pattern, measurement_start
    into v_site_id, v_url, v_pattern, v_start
    from public.network_seo_changes
   where id = p_change_id;
  if v_site_id is null or v_start is null then
    return;
  end if;

  v_before_end   := v_start - 1;
  v_before_start := v_before_end - 27;
  v_after_end    := (now() at time zone 'UTC')::date;

  -- Before window.
  return query
  with sel as (
    select date, clicks, impressions, position_avg
      from public.network_gsc_url_daily
     where site_id = v_site_id
       and date between v_before_start and v_before_end
       and (
             (v_url is not null and page = v_url)
          or (v_pattern is not null and page like replace(v_pattern, '*', '%'))
          or (v_url is null and v_pattern is null)
       )
  ),
  ga as (
    select coalesce(sum(active_users), 0)::bigint as u,
           coalesce(sum(sessions), 0)::bigint     as s
      from public.network_ga4_site_daily
     where site_id = v_site_id
       and date between v_before_start and v_before_end
  )
  select 'before'::text,
         coalesce(sum(sel.clicks), 0)::bigint,
         coalesce(sum(sel.impressions), 0)::bigint,
         case when sum(sel.impressions) > 0
              then sum(sel.impressions * sel.position_avg) / sum(sel.impressions)
              end,
         (select u from ga), (select s from ga),
         v_before_start, v_before_end
    from sel;

  -- After window (from measurement_start forward).
  return query
  with sel as (
    select date, clicks, impressions, position_avg
      from public.network_gsc_url_daily
     where site_id = v_site_id
       and date between v_start and v_after_end
       and (
             (v_url is not null and page = v_url)
          or (v_pattern is not null and page like replace(v_pattern, '*', '%'))
          or (v_url is null and v_pattern is null)
       )
  ),
  ga as (
    select coalesce(sum(active_users), 0)::bigint as u,
           coalesce(sum(sessions), 0)::bigint     as s
      from public.network_ga4_site_daily
     where site_id = v_site_id
       and date between v_start and v_after_end
  )
  select 'after'::text,
         coalesce(sum(sel.clicks), 0)::bigint,
         coalesce(sum(sel.impressions), 0)::bigint,
         case when sum(sel.impressions) > 0
              then sum(sel.impressions * sel.position_avg) / sum(sel.impressions)
              end,
         (select u from ga), (select s from ga),
         v_start, v_after_end
    from sel;
end;
$$;

revoke all on function public.network_seo_change_performance(uuid) from public;
grant execute on function public.network_seo_change_performance(uuid)
  to authenticated, service_role;
