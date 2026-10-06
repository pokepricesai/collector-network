-- =============================================================
-- Phase 6 Checkpoint B.1 · Autopilot external source registry
-- =============================================================
-- Lets the editorial pipeline discover topics from the wider
-- Yu-Gi-Oh! world (and later other TCGs). The design is strictly
-- deterministic — no LLM web-browsing. The pipeline reads RSS/Atom
-- feeds (or well-known listing pages) from the registered sources,
-- stores discovered signals, and scores them for editorial value.
--
-- Two tables:
--
--   network_autopilot_sources
--     Admin-curated source registry. Each row carries a trust_level
--     (1 official / 2 secondary / 3 community) so downstream scoring
--     knows how much to weight that source.
--
--   network_autopilot_discovered_signals
--     Append-only log of what the discovery pass turned up. A later
--     cron will refresh this daily; for now we read + write it
--     synchronously from the admin preview.

-- ─────────────────────────────────────────────────────────────
-- 1. network_autopilot_sources
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'network_autopilot_source_tier') then
    create type public.network_autopilot_source_tier as enum ('official', 'secondary', 'community');
  end if;
  if not exists (select 1 from pg_type where typname = 'network_autopilot_discovery_method') then
    create type public.network_autopilot_discovery_method as enum ('rss', 'atom', 'json_feed', 'sitemap', 'manual');
  end if;
end $$;

create table if not exists public.network_autopilot_sources (
  id                 uuid primary key default gen_random_uuid(),
  site_slug          text not null,                           -- 'ygo', 'pokemon', etc. — which collector-network site this source feeds
  name               text not null,                           -- human label, e.g. 'YGOrganization'
  domain             text not null,                           -- primary domain for dedupe + trust lookup
  category           text,                                    -- 'news' | 'reference' | 'retailer' | 'community' | ...
  tier               public.network_autopilot_source_tier not null default 'secondary',
  trust_level        smallint not null default 2
                     check (trust_level between 1 and 3),
  official           boolean not null default false,          -- true for Konami / official Yu-Gi-Oh channels
  discovery_method   public.network_autopilot_discovery_method not null default 'rss',
  feed_url           text,                                    -- RSS / Atom / JSON feed URL
  listing_url        text,                                    -- fallback human page for sitemap/manual methods
  content_usage_policy text,                                  -- short note on what we may and may not reproduce
  enabled            boolean not null default true,
  last_discovered_at timestamptz,
  last_signal_count  integer,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (site_slug, name)
);

create index if not exists network_autopilot_sources_site_enabled_idx
  on public.network_autopilot_sources (site_slug, enabled, tier);

alter table public.network_autopilot_sources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_autopilot_sources'
      and policyname = 'network_autopilot_sources_admin'
  ) then
    create policy network_autopilot_sources_admin
      on public.network_autopilot_sources
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

comment on table public.network_autopilot_sources is
  'Admin-curated registry of trusted sources the autopilot discovery pass may fetch. The pipeline never fetches a domain not listed here.';

-- ─────────────────────────────────────────────────────────────
-- 2. network_autopilot_discovered_signals
-- ─────────────────────────────────────────────────────────────

create table if not exists public.network_autopilot_discovered_signals (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.network_autopilot_sources (id) on delete cascade,
  site_slug         text not null,
  signal_hash       text not null,                            -- sha256(canonical(url))
  url               text not null,
  title             text,
  summary           text,
  published_at      timestamptz,
  retrieved_at      timestamptz not null default now(),
  extracted_at      timestamptz,                              -- when full fetch populated the fields below
  og_image_url      text,
  publisher         text,
  topic_keywords    text[] not null default '{}',
  cluster_key       text,                                     -- same cluster_key = same story across sources
  dismissed_at      timestamptz,
  dismiss_reason    text,
  unique (source_id, signal_hash)
);

create index if not exists network_autopilot_signals_site_published_idx
  on public.network_autopilot_discovered_signals (site_slug, published_at desc)
  where dismissed_at is null;
create index if not exists network_autopilot_signals_cluster_idx
  on public.network_autopilot_discovered_signals (site_slug, cluster_key)
  where cluster_key is not null;

alter table public.network_autopilot_discovered_signals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'network_autopilot_discovered_signals'
      and policyname = 'network_autopilot_signals_admin'
  ) then
    create policy network_autopilot_signals_admin
      on public.network_autopilot_discovered_signals
      for all
      using (public.network_is_admin())
      with check (public.network_is_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────
-- 3. Seed YGO sources
-- ─────────────────────────────────────────────────────────────
--
-- A conservative starter set. All entries are DISABLED by default
-- so no network fetching happens until an admin explicitly turns a
-- source on at /admin/content/autopilot/sources. Feed URLs are
-- known-public endpoints; some may need adjustment once we see live
-- responses — the admin page lets an operator edit each row.

insert into public.network_autopilot_sources (
  site_slug, name, domain, category, tier, trust_level, official,
  discovery_method, feed_url, listing_url, content_usage_policy, enabled, notes
) values
  ('ygo', 'Konami official news',    'konami.com',       'official_news', 'official',  1, true,  'manual',  null,
    'https://www.konami.com/yugioh/duel_links/en-us/news/',
    'Official Konami announcements. Highest factual trust. Short attributed quotes only; never reproduce whole articles.',
    false,
    'Konami does not publish an RSS feed; discovery_method=manual. The pipeline will treat this as a tier-1 anchor until a feed is wired.'),
  ('ygo', 'Yu-Gi-Oh! TCG official',  'yugioh-card.com',  'official_news', 'official',  1, true,  'manual',  null,
    'https://www.yugioh-card.com/en/',
    'Official TCG site. Tier 1. Short attributed quotes only.',
    false,
    'No standard RSS feed found. Manual listing scrape in a later checkpoint.'),
  ('ygo', 'YGOrganization',          'ygorganization.com','news_reveal',   'secondary', 2, false, 'rss',
    'https://ygorganization.com/feed/',
    'https://ygorganization.com/',
    'Established card-reveal and news site. Can reproduce short attributed quotes; synthesise across sources.',
    false,
    null),
  ('ygo', 'TCGplayer Infinite',      'infinite.tcgplayer.com', 'editorial', 'secondary', 2, false, 'rss',
    'https://infinite.tcgplayer.com/articles.rss',
    'https://infinite.tcgplayer.com/articles/yugioh/',
    'Editorial content from TCGplayer. Short attributed quotes only.',
    false,
    'TCGplayer feed covers multiple games. Discovery filters to Yu-Gi-Oh! by URL/keyword in the feed items.'),
  ('ygo', 'YGOPRODeck news',         'ygoprodeck.com',   'reference',     'secondary', 2, false, 'rss',
    'https://ygoprodeck.com/feed/',
    'https://ygoprodeck.com/',
    'Reference + news. Secondary trust.',
    false,
    null),
  ('ygo', 'Pojo Yu-Gi-Oh! news',     'pojo.com',         'news',          'secondary', 2, false, 'rss',
    'https://www.pojo.com/yu-gi-oh/feed/',
    'https://www.pojo.com/yu-gi-oh/',
    'Long-running TCG news site.',
    false,
    null),
  ('ygo', 'Reddit /r/yugioh',        'reddit.com',       'community',     'community', 3, false, 'rss',
    'https://www.reddit.com/r/yugioh/.rss',
    'https://www.reddit.com/r/yugioh/',
    'Community discussion. Treat as discovery signal only; never cite as authoritative evidence.',
    false,
    'Rate-limited; respect User-Agent requirements.'),
  ('ygo', 'Reddit /r/YuGiOhMarket',   'reddit.com',       'community',     'community', 3, false, 'rss',
    'https://www.reddit.com/r/YuGiOhMarket/.rss',
    'https://www.reddit.com/r/YuGiOhMarket/',
    'Market-focused community posts. Signal only.',
    false,
    null)
on conflict (site_slug, name) do nothing;
