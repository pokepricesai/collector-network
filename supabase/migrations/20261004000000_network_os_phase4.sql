-- =============================================================
-- Collector Network OS — Phase 4: social + newsletter + distribution
-- =============================================================
--
-- Turns approved content + live network data into a low-maintenance
-- distribution system. Lifecycle:
--
--   data / article / event → social opportunity → AI draft
--     → editorial check → human approval → schedule → publish
--     → measure → learn
--
-- Luke dislikes manually running social; the goal is approve-only,
-- not compose-manually. No autonomous public posting during the
-- acceptance test — adapter runs in dry-run mode until an explicit
-- real post is approved.
--
-- Architecture guarantees:
--   • Accounts are first-class and future-proofed. One primary
--     network-level account today; schema accommodates per-site
--     accounts (pokemon/mtg/ygo/onepiece/lorcana) without redesign.
--   • Approval state is explicit at every gate (reuses
--     network_approvals from Phase 0).
--   • Post lifecycle: idea → draft → review → approved →
--     scheduled → publishing → published → failed → cancelled.
--   • Threads are modelled as ordered children of a parent post
--     (parent_post_id + thread_position) rather than monolithic
--     text, so each child retains its own evidence provenance.
--   • Publications are append-only with an explicit idempotency
--     key so a retry can't double-publish.
--   • Metrics table is additive (one row per retrieval) — never
--     overwrites a previous reading, so we can see how metrics
--     evolved over time.

-- --- 1. Enums ---------------------------------------------------
do $$
begin
  create type public.network_social_post_status as enum (
    'idea', 'draft', 'review', 'approved',
    'scheduled', 'publishing', 'published', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_social_platform as enum (
    'x', 'threads', 'linkedin', 'bluesky', 'mastodon'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_social_post_type as enum (
    'data_insight', 'market_mover', 'article_share',
    'feature_update', 'network_update', 'collector_observation',
    'engagement_question', 'release_note', 'partner_sponsor',
    'thread', 'manual'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_newsletter_status as enum (
    'draft', 'review', 'approved', 'scheduled', 'sent', 'failed', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- --- 2. Social accounts -----------------------------------------
--
-- One row per (platform, external handle). site_id is NULLABLE: the
-- initial primary account is Luke | Collector Network (site_id = null,
-- "the network"). Later site-specific accounts attach to the matching
-- site. External credentials are referenced by env-var name, never
-- stored in the DB.

create table if not exists public.network_social_accounts (
  id                 uuid primary key default gen_random_uuid(),
  platform           public.network_social_platform not null,
  site_id            uuid references public.network_sites (id) on delete cascade,
  handle             text not null,                   -- e.g. 'LukeCollectorNet'
  display_name       text not null,
  bio                text,
  profile_url        text,
  oauth_state        text not null default 'not_connected'
                     check (oauth_state in ('not_connected', 'pending', 'connected', 'error', 'disabled')),
  credential_envs    jsonb not null default '{}'::jsonb,  -- {access_token_env: 'X_...', client_id_env: '...'}
  external_user_id   text,                            -- X user id when connected
  last_token_refresh timestamptz,
  last_post_at       timestamptz,
  config             jsonb not null default '{}'::jsonb,
  is_primary         boolean not null default false,  -- primary posting target for its scope
  status             text not null default 'active'
                     check (status in ('active', 'paused', 'archived')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (platform, handle)
);

create index if not exists network_social_accounts_platform_status_idx
  on public.network_social_accounts (platform, status);
create index if not exists network_social_accounts_site_idx
  on public.network_social_accounts (site_id) where site_id is not null;

-- --- 3. Social voice profiles -----------------------------------
--
-- Separate from content/article voice. "Luke | Collector Network"
-- is deliberately conversational and data-aware rather than
-- corporate. Links to an account OR to a site (site-level style)
-- via nullable site_id + nullable account_id. Account overrides
-- site; site overrides network default.

create table if not exists public.network_social_voice_profiles (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid references public.network_social_accounts (id) on delete cascade,
  site_id            uuid references public.network_sites (id) on delete cascade,
  label              text not null,
  audience           text not null,
  tone               text not null,
  terminology        text not null,
  do_not             text not null,
  content_mix        jsonb not null default '{}'::jsonb,  -- {useful: 70, product: 20, commercial: 10}
  example_posts      jsonb not null default '[]'::jsonb,
  example_antipatterns jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.network_admin_users (id) on delete set null,
  unique (account_id, site_id)
);

-- --- 4. Social ideas --------------------------------------------
--
-- Evidence-backed social opportunity. May come from a published
-- article, a market mover, a daily-brief notable change, or a
-- manual-entry. The engine dedupes on (account_id, dedupe_key).

create table if not exists public.network_social_ideas (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.network_social_accounts (id) on delete cascade,
  site_id            uuid references public.network_sites (id) on delete set null,
  post_type          public.network_social_post_type not null default 'data_insight',
  working_title      text not null,
  summary            text,
  priority           public.network_task_priority not null default 'normal',
  status             public.network_idea_status not null default 'new',
  origin_type        text not null default 'manual',
  -- origin kinds: article, published_article, market_mover,
  -- brief_notable, feature_launch, manual, refresh, partnership
  origin_id          uuid,
  origin_entity_type text,                            -- 'article' | 'opportunity' | 'brief' | ...
  evidence           jsonb not null default '{}'::jsonb,
  dedupe_key         text not null,
  first_seen_at      timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  created_by         uuid references public.network_admin_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  dismissed_at       timestamptz,
  dismiss_reason     text,
  unique (account_id, dedupe_key)
);

create index if not exists network_social_ideas_account_status_idx
  on public.network_social_ideas (account_id, status, priority);

-- --- 5. Social posts --------------------------------------------
--
-- One row per planned post. A thread is modelled by a parent post
-- (thread_position = 0) with ordered children (parent_post_id =
-- parent.id, thread_position = 1..N). This keeps per-child evidence
-- and per-child publication records intact.

create table if not exists public.network_social_posts (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.network_social_accounts (id) on delete cascade,
  site_id            uuid references public.network_sites (id) on delete set null,
  idea_id            uuid references public.network_social_ideas (id) on delete set null,
  source_article_id  uuid references public.network_articles (id) on delete set null,
  parent_post_id     uuid references public.network_social_posts (id) on delete cascade,
  thread_position    integer not null default 0,      -- 0 = standalone or thread head
  post_type          public.network_social_post_type not null default 'data_insight',
  text               text not null,
  links              text[] not null default '{}',    -- extracted link URLs
  media              jsonb not null default '[]'::jsonb,
  status             public.network_social_post_status not null default 'draft',
  approval_id        uuid references public.network_approvals (id) on delete set null,
  scheduled_for      timestamptz,
  scheduled_tz       text default 'Europe/London',
  posted_at          timestamptz,
  external_post_id   text,                            -- X tweet id after publish
  external_url       text,
  evidence           jsonb not null default '{}'::jsonb,
  qc_report          jsonb not null default '{}'::jsonb,
  actor_type         public.network_actor_type not null default 'ai',
  ai_provider        text,
  ai_model           text,
  ai_est_cost_usd    numeric(10, 6),
  created_by         uuid references public.network_admin_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists network_social_posts_account_status_idx
  on public.network_social_posts (account_id, status);
create index if not exists network_social_posts_scheduled_idx
  on public.network_social_posts (scheduled_for)
  where status in ('approved', 'scheduled');
create index if not exists network_social_posts_thread_idx
  on public.network_social_posts (parent_post_id, thread_position)
  where parent_post_id is not null;

-- --- 6. Social post versions ------------------------------------
create table if not exists public.network_social_versions (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.network_social_posts (id) on delete cascade,
  version            integer not null,
  content            jsonb not null,
  actor_type         public.network_actor_type not null,
  actor_user_id      uuid references public.network_admin_users (id) on delete set null,
  change_note        text,
  created_at         timestamptz not null default now(),
  unique (post_id, version)
);

create index if not exists network_social_versions_post_idx
  on public.network_social_versions (post_id, version desc);

-- --- 7. Social publications -------------------------------------
--
-- Append-only. One row per publish attempt. idempotency_key
-- prevents a retry (either manual or cron) from double-posting on
-- the same post_id + attempt instance.

create table if not exists public.network_social_publications (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.network_social_posts (id) on delete cascade,
  account_id         uuid not null references public.network_social_accounts (id) on delete cascade,
  idempotency_key    text not null,
  mode               text not null default 'dry_run'
                     check (mode in ('dry_run', 'preview', 'live')),
  status             text not null default 'pending'
                     check (status in ('pending', 'success', 'failed', 'skipped')),
  attempted_at       timestamptz not null default now(),
  completed_at       timestamptz,
  external_post_id   text,
  external_url       text,
  payload            jsonb not null default '{}'::jsonb,
  response           jsonb not null default '{}'::jsonb,
  error_summary      text,
  unique (post_id, idempotency_key)
);

create index if not exists network_social_publications_post_idx
  on public.network_social_publications (post_id, attempted_at desc);

-- --- 8. Social metrics ------------------------------------------
--
-- Additive snapshots. We never update a prior row — new readings
-- insert new rows so we can plot how impressions/likes drifted
-- across time without losing earlier observations.

create table if not exists public.network_social_metrics (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.network_social_posts (id) on delete cascade,
  retrieved_at       timestamptz not null default now(),
  impressions        integer,
  likes              integer,
  replies            integer,
  reposts            integer,
  bookmarks          integer,
  link_clicks        integer,
  profile_visits     integer,
  raw                jsonb not null default '{}'::jsonb
);

create index if not exists network_social_metrics_post_idx
  on public.network_social_metrics (post_id, retrieved_at desc);

-- --- 9. Newsletters (minimal) -----------------------------------
--
-- Draft-only in Phase 4 — no auto-send. PokePrices already has a
-- newsletter studio in its own project; this is a CN OS parallel
-- for the network-level newsletter that can later route to that
-- studio OR a separate send provider.

create table if not exists public.network_newsletters (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  subject_line       text,
  preheader          text,
  for_date           date,
  status             public.network_newsletter_status not null default 'draft',
  approval_id        uuid references public.network_approvals (id) on delete set null,
  send_target        text default 'manual_relay'
                     check (send_target in ('manual_relay', 'pokeprices_studio', 'resend', 'ses')),
  scheduled_for      timestamptz,
  sent_at            timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  ai_provider        text,
  ai_model           text,
  ai_est_cost_usd    numeric(10, 6),
  created_by         uuid references public.network_admin_users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.network_newsletter_sections (
  id                 uuid primary key default gen_random_uuid(),
  newsletter_id      uuid not null references public.network_newsletters (id) on delete cascade,
  position           integer not null,
  heading            text,
  body_markdown      text not null,
  source_kind        text,                           -- 'article' | 'brief' | 'mover' | 'manual'
  source_ref         uuid,                           -- polymorphic ref to article/idea/opp
  evidence           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create index if not exists network_newsletter_sections_order_idx
  on public.network_newsletter_sections (newsletter_id, position);

create table if not exists public.network_newsletter_publications (
  id                 uuid primary key default gen_random_uuid(),
  newsletter_id      uuid not null references public.network_newsletters (id) on delete cascade,
  send_target        text not null,
  mode               text not null default 'preview'
                     check (mode in ('preview', 'live')),
  status             text not null default 'pending'
                     check (status in ('pending', 'success', 'failed')),
  attempted_at       timestamptz not null default now(),
  completed_at       timestamptz,
  payload            jsonb not null default '{}'::jsonb,
  response           jsonb not null default '{}'::jsonb,
  error_summary      text
);

-- --- 10. RLS + policies ------------------------------------------
alter table public.network_social_accounts         enable row level security;
alter table public.network_social_voice_profiles   enable row level security;
alter table public.network_social_ideas            enable row level security;
alter table public.network_social_posts            enable row level security;
alter table public.network_social_versions         enable row level security;
alter table public.network_social_publications     enable row level security;
alter table public.network_social_metrics          enable row level security;
alter table public.network_newsletters             enable row level security;
alter table public.network_newsletter_sections     enable row level security;
alter table public.network_newsletter_publications enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_social_accounts',
    'network_social_voice_profiles',
    'network_social_ideas',
    'network_social_posts',
    'network_social_versions',
    'network_social_publications',
    'network_social_metrics',
    'network_newsletters',
    'network_newsletter_sections',
    'network_newsletter_publications'
  ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.network_is_admin())', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- --- 11. Touch triggers ------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_social_accounts',
    'network_social_voice_profiles',
    'network_social_ideas',
    'network_social_posts',
    'network_newsletters'
  ])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.network_touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- --- 12. Social post version snapshot RPC ------------------------
create or replace function public.network_snapshot_social_post(
  p_post_id uuid,
  p_actor_type public.network_actor_type default 'human',
  p_actor_user_id uuid default null,
  p_change_note text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_next integer;
  v_content jsonb;
  v_id uuid;
begin
  select coalesce(max(version), 0) + 1 into v_next
    from public.network_social_versions
   where post_id = p_post_id;
  select to_jsonb(p.*) into v_content
    from public.network_social_posts p where p.id = p_post_id;
  if v_content is null then
    raise exception 'network_snapshot_social_post: post % not found', p_post_id;
  end if;
  insert into public.network_social_versions
    (post_id, version, content, actor_type, actor_user_id, change_note)
  values
    (p_post_id, v_next, v_content, p_actor_type, p_actor_user_id, p_change_note)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.network_snapshot_social_post
  (uuid, public.network_actor_type, uuid, text)
  to authenticated, service_role;

-- --- 13. Seed primary account + voice ---------------------------
--
-- Luke | Collector Network, network-level X account. OAuth
-- deliberately 'not_connected' — the admin configures credential
-- env-var names via /admin/integrations later.

insert into public.network_social_accounts
  (platform, site_id, handle, display_name, bio, oauth_state, is_primary, credential_envs, config)
values
  ('x', null, 'LukeCollectorNet', 'Luke | Collector Network',
   'Building a network for serious TCG collectors — Pokémon, MTG, Yu-Gi-Oh!, One Piece, Lorcana. Live pricing, data-driven market insight.',
   'not_connected', true,
   '{"access_token_env": "X_USER_ACCESS_TOKEN", "refresh_token_env": "X_USER_REFRESH_TOKEN", "client_id_env": "X_CLIENT_ID", "client_secret_env": "X_CLIENT_SECRET"}'::jsonb,
   '{"timezone": "Europe/London", "safe_mode": true, "max_posts_per_day_cap": 6, "min_interval_minutes": 30}'::jsonb)
on conflict (platform, handle) do update
  set display_name = excluded.display_name,
      bio = excluded.bio,
      is_primary = excluded.is_primary,
      credential_envs = excluded.credential_envs,
      config = coalesce(public.network_social_accounts.config, '{}'::jsonb) || excluded.config,
      updated_at = now();

-- Voice profile for the primary network account.
do $$
declare
  v_acc uuid;
begin
  select id into v_acc from public.network_social_accounts
    where platform = 'x' and handle = 'LukeCollectorNet' limit 1;
  insert into public.network_social_voice_profiles
    (account_id, site_id, label, audience, tone, terminology, do_not, content_mix, example_posts, example_antipatterns)
  values
    (v_acc, null, 'Luke | Collector Network — primary network voice',
     'TCG collectors across Pokémon, MTG, Yu-Gi-Oh!, One Piece, Lorcana. Mix of serious data-driven collectors and curious market-trackers. UK/EU-leaning, English-speaking.',
     'Human, knowledgeable, curious, data-aware, collector-focused, lightly conversational. First person acceptable. Comfortable saying "interesting one from the data this week". Never corporate press-release, never AI-marketing-bot, never breathless hype, never engagement-bait.',
     'Pokémon TCG (with accent). Magic: The Gathering / MTG (with colon). Yu-Gi-Oh! (with exclamation). One Piece Card Game / OP TCG. Disney Lorcana. Use set codes in parens on first mention (BS, LOB, OP01, etc.). Distinguish raw / graded (PSA / BGS / CGC). Avoid "chase" unless warranted. Prices in USD by default, mention GBP/EUR only if source specifies.',
     'Do NOT: use spammy emojis or hashtag soup. Do NOT invent prices, release dates, pop reports, auction results, rules changes, or Konami/Wizards/Bandai/Ravensburger announcements. Do NOT use "🚨 MASSIVE MARKET ALERT 🚨" or similar engagement-bait. Do NOT predict future prices as fact. Do NOT post vanity-stat spam ("network just hit X!"). Do NOT auto-insert hashtags; one or two restrained ones are fine when relevant.',
     '{"useful": 70, "product": 20, "commercial": 10}'::jsonb,
     '["Interesting one from the data this week: Rayquaza EX #85 (Dragons Exalted) PSA 10 moved from ~$1,413 to ~$3,151 across September. Thirteen reported sales. Not a crash signal — just a quiet climb.", "Three Call of Legends shinies all firmed in September raw. SL1 Deoxys, SL6 Kyogre, SL7 Lugia. The subset keeps acting like a subset.", "Added September 2026 movers to pokeprices.io/insights — raw and PSA 10 separated, methodology inline. Numbers come straight from our daily pricing feed.", "Working on the sitemap for YGOprices this week — the catalog is now large enough that it needed splitting. Nothing exciting on the surface; everything less brittle underneath."]'::jsonb,
     '["🚨 MASSIVE POKÉMON ALERT 🚨 Charizard just MOONED!! 🔥📈 #PokemonTCG #Investment #Crypto", "Our platform is REVOLUTIONIZING how collectors track prices! Join the Collector Network revolution today! 🚀", "Who else is BUYING Rayquaza PSA 10 right now?? 🤑 Reply with your plays! 💰"]'::jsonb)
  on conflict (account_id, site_id) do update
    set audience = excluded.audience,
        tone = excluded.tone,
        terminology = excluded.terminology,
        do_not = excluded.do_not,
        content_mix = excluded.content_mix,
        example_posts = excluded.example_posts,
        example_antipatterns = excluded.example_antipatterns,
        updated_at = now();
end $$;

-- --- 14. Data sources + integration rows ------------------------
insert into public.network_data_sources (code, display_name, category, description)
values
  ('social_x', 'X (Twitter)', 'external', 'X API v2 posting + metrics'),
  ('newsletter', 'Newsletter', 'external', 'Email newsletter sends via Resend / SES / PokePrices studio relay'),
  ('editorial_qc', 'Editorial AI QC', 'derived', 'Semantic quality checks for articles + social posts')
on conflict (code) do nothing;

insert into public.network_integrations (provider, site_id, status, credential_env)
values ('x', null, 'not_connected', 'X_USER_ACCESS_TOKEN'),
       ('resend', null, 'not_connected', 'RESEND_API_KEY')
on conflict (provider, site_id) do nothing;
