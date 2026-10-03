-- =============================================================
-- Collector Network OS — Phase 3: content engine + article workflow
-- =============================================================
--
-- Turns Phase 2 intelligence into a controlled content production
-- system. Lifecycle:
--
--   idea → brief → draft → review → approved → scheduled → publishing
--        → published → (archived)
--
-- Approval state (via network_approvals) is kept separate from
-- publication state so a brief approval and a publish approval are
-- distinct audit events.
--
-- Site publishing targets differ by audit:
--   • ygo_db / onepiece_db / lorcana_db — these three sites share the
--     CN OS Supabase project and are extended to read fallback
--     articles from network_articles.
--   • pokeprices_external — PokePrices already has its own CMS
--     (public.insights in the pokeprices-web Supabase project); CN
--     records a tracking row and surfaces a payload for the operator
--     to publish manually there.
--   • mtgprices_markdown — MTGPrices content is markdown committed
--     to the mtgprices-web repo; CN emits the exact .md payload for
--     the operator to commit.
--
-- All AI-generated content must retain provenance. network_article_sources
-- distinguishes internal_data, external_research, and editorial so
-- unsupported claims are never silently promoted.

-- --- 1. Enums -----------------------------------------------------
do $$
begin
  create type public.network_article_status as enum (
    'idea', 'brief', 'draft', 'review', 'approved',
    'scheduled', 'publishing', 'published', 'failed', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_idea_status as enum (
    'new', 'in_brief', 'drafting', 'published', 'dismissed', 'stale'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_brief_status as enum (
    'draft', 'in_review', 'approved', 'rejected'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_publication_target as enum (
    'ygo_db', 'onepiece_db', 'lorcana_db',
    'pokeprices_external', 'mtgprices_markdown'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_content_type as enum (
    'seo_article', 'news', 'market_analysis', 'evergreen_guide',
    'set_guide', 'entity_feature', 'buying_guide', 'editorial'
  );
exception when duplicate_object then null; end $$;

-- --- 2. Site voice profiles ---------------------------------------
--
-- Per-site content voice. Updated through /admin/content/voice (not
-- yet implemented in Phase 3) or directly via SQL. Phase 3 seeds
-- these from the known positioning of each site.

create table if not exists public.network_voice_profiles (
  site_id          uuid primary key references public.network_sites (id) on delete cascade,
  audience         text not null,
  tone             text not null,
  terminology      text not null,
  content_emphasis text not null,
  preferred_structure text,
  balance          text,                 -- e.g. "50% collector / 50% gameplay"
  do_not           text,                 -- behaviours/claims to avoid
  naming_rules     text,
  canonical_tag    text,                 -- "Yu-Gi-Oh!" with exclamation, etc.
  example_openings jsonb not null default '[]'::jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.network_admin_users (id) on delete set null
);

-- --- 3. Content ideas --------------------------------------------
create table if not exists public.network_content_ideas (
  id               uuid primary key default gen_random_uuid(),
  site_id          uuid not null references public.network_sites (id) on delete cascade,
  content_type     public.network_content_type not null default 'seo_article',
  working_title    text not null,
  primary_query    text,
  secondary_queries text[] not null default '{}',
  summary          text,
  notes            text,
  priority         public.network_task_priority not null default 'normal',
  status           public.network_idea_status not null default 'new',
  origin_type      text not null default 'manual',          -- opportunity | page_opp | content_gap | cannibal | manual | refresh
  origin_id        uuid,                                    -- id of the originating opp (polymorphic)
  evidence         jsonb not null default '{}'::jsonb,
  dedupe_key       text not null,                           -- site:kind:slug-of-title — unique
  created_by       uuid references public.network_admin_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  dismissed_at     timestamptz,
  dismiss_reason   text,
  unique (site_id, dedupe_key)
);

create index if not exists network_content_ideas_site_status_idx
  on public.network_content_ideas (site_id, status, priority);
create index if not exists network_content_ideas_origin_idx
  on public.network_content_ideas (origin_type, origin_id);

-- --- 4. Content briefs --------------------------------------------
--
-- A brief is a structured plan for a single article. May be
-- AI-generated OR hand-written. Must be approved before draft.
--
-- payload JSONB shape (versioned by brief_schema_version):
--   {
--     purpose: string,
--     reader_intent: string,
--     primary_query: string,
--     secondary_queries: [string],
--     evidence_summary: string,
--     recommended_angle: string,
--     outline: [{ h2: string, h3s?: [string], notes?: string }],
--     suggested_h1: string,
--     required_facts: [string],
--     entities_to_mention: [string],
--     suggested_internal_links: [{ target_url, anchor, reason }],
--     external_source_requirements: [string],
--     seo_notes: string,
--     suggested_meta_title: string,
--     suggested_meta_description: string,
--     suggested_schema_type: string,
--     things_not_to_claim: [string],
--     freshness_requirements: string,
--     research_gaps: [string]   -- "RESEARCH REQUIRED" flags
--   }

create table if not exists public.network_content_briefs (
  id               uuid primary key default gen_random_uuid(),
  idea_id          uuid not null references public.network_content_ideas (id) on delete cascade,
  site_id          uuid not null references public.network_sites (id) on delete cascade,
  content_type     public.network_content_type not null,
  payload          jsonb not null,
  brief_schema_version integer not null default 1,
  status           public.network_brief_status not null default 'draft',
  approval_id      uuid references public.network_approvals (id) on delete set null,
  actor_type       public.network_actor_type not null default 'ai',
  ai_provider      text,
  ai_model         text,
  ai_input_tokens  integer,
  ai_output_tokens integer,
  ai_est_cost_usd  numeric(10, 6),
  generated_at     timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      uuid references public.network_admin_users (id) on delete set null,
  rejection_reason text,
  created_by       uuid references public.network_admin_users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists network_content_briefs_idea_idx
  on public.network_content_briefs (idea_id, status);
create index if not exists network_content_briefs_site_status_idx
  on public.network_content_briefs (site_id, status);

-- --- 5. Articles --------------------------------------------------
create table if not exists public.network_articles (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references public.network_sites (id) on delete cascade,
  idea_id             uuid references public.network_content_ideas (id) on delete set null,
  brief_id            uuid references public.network_content_briefs (id) on delete set null,
  title               text not null,
  working_title       text,
  slug                text not null,
  status              public.network_article_status not null default 'draft',
  content_type        public.network_content_type not null default 'seo_article',
  primary_query       text,
  secondary_queries   text[] not null default '{}',
  summary             text,
  body                text,                        -- markdown (canonical) / HTML / TSX source
  body_format         text not null default 'markdown' check (body_format in ('markdown', 'html', 'tsx')),
  meta_title          text,
  meta_description    text,
  canonical_target    text,
  featured_image_url  text,
  author              text default 'Collector Network',
  publication_target  public.network_publication_target not null,
  scheduled_for       timestamptz,
  published_at        timestamptz,
  publication_url     text,
  qc_report           jsonb not null default '{}'::jsonb,
  seo_change_id       uuid references public.network_seo_changes (id) on delete set null,
  created_by          uuid references public.network_admin_users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (site_id, slug)
);

create index if not exists network_articles_site_status_idx
  on public.network_articles (site_id, status);
create index if not exists network_articles_published_at_idx
  on public.network_articles (published_at desc)
  where published_at is not null;

-- --- 6. Article versions ------------------------------------------
--
-- Snapshot on every material edit. Never destructive. Append-only.

create table if not exists public.network_article_versions (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.network_articles (id) on delete cascade,
  version         integer not null,
  content         jsonb not null,                  -- full article snapshot
  actor_type      public.network_actor_type not null,
  actor_user_id   uuid references public.network_admin_users (id) on delete set null,
  change_note     text,
  created_at      timestamptz not null default now(),
  unique (article_id, version)
);

create index if not exists network_article_versions_article_idx
  on public.network_article_versions (article_id, version desc);

-- --- 7. Article sources (provenance) ------------------------------
create table if not exists public.network_article_sources (
  id              uuid primary key default gen_random_uuid(),
  article_id      uuid not null references public.network_articles (id) on delete cascade,
  source_type     text not null check (source_type in ('internal_data', 'external_research', 'editorial')),
  source_name     text not null,
  source_url      text,
  internal_reference text,                         -- e.g. 'network_gsc_url_query_daily:28d'
  claim_scope     text,                            -- what the source actually supports
  retrieved_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists network_article_sources_article_idx
  on public.network_article_sources (article_id);

-- --- 8. Article internal links (suggested + accepted) -------------
create table if not exists public.network_article_links (
  id                     uuid primary key default gen_random_uuid(),
  article_id             uuid not null references public.network_articles (id) on delete cascade,
  target_url             text not null,
  anchor_text            text,
  reason                 text,
  relationship           text,
  state                  text not null default 'suggested'
                         check (state in ('suggested', 'accepted', 'rejected', 'edited')),
  source_opportunity_id  uuid references public.network_internal_link_opportunities (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists network_article_links_article_idx
  on public.network_article_links (article_id, state);

-- --- 9. Content publications --------------------------------------
--
-- One row per publish attempt (success or failed). Lets us keep
-- the article row simple while recording multiple publish attempts.

create table if not exists public.network_content_publications (
  id                 uuid primary key default gen_random_uuid(),
  article_id         uuid not null references public.network_articles (id) on delete cascade,
  site_id            uuid not null references public.network_sites (id) on delete cascade,
  publication_target public.network_publication_target not null,
  target_record_id   text,                         -- external CMS id if applicable
  publication_url    text,
  commit_sha         text,
  payload            jsonb not null default '{}'::jsonb, -- adapter-specific publish payload
  status             text not null default 'pending'
                     check (status in ('pending', 'manual_pending', 'success', 'failed', 'preview')),
  attempted_at       timestamptz not null default now(),
  completed_at       timestamptz,
  error_summary      text,
  seo_change_id      uuid references public.network_seo_changes (id) on delete set null,
  metadata           jsonb not null default '{}'::jsonb
);

create index if not exists network_content_publications_article_idx
  on public.network_content_publications (article_id, status);

-- --- 10. AI cost log ---------------------------------------------
create table if not exists public.network_ai_cost_log (
  id               uuid primary key default gen_random_uuid(),
  operation        text not null,                  -- 'brief' | 'draft' | 'revision' | 'summary'
  provider         text not null,
  model            text not null,
  article_id       uuid references public.network_articles (id) on delete set null,
  brief_id         uuid references public.network_content_briefs (id) on delete set null,
  idea_id          uuid references public.network_content_ideas (id) on delete set null,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  est_cost_usd     numeric(10, 6) not null default 0,
  actor_user_id    uuid references public.network_admin_users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists network_ai_cost_log_created_idx
  on public.network_ai_cost_log (created_at desc);

-- --- 11. RLS enablement + policies -------------------------------
alter table public.network_voice_profiles          enable row level security;
alter table public.network_content_ideas           enable row level security;
alter table public.network_content_briefs          enable row level security;
alter table public.network_articles                enable row level security;
alter table public.network_article_versions        enable row level security;
alter table public.network_article_sources         enable row level security;
alter table public.network_article_links           enable row level security;
alter table public.network_content_publications    enable row level security;
alter table public.network_ai_cost_log             enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_voice_profiles',
    'network_content_ideas',
    'network_content_briefs',
    'network_articles',
    'network_article_versions',
    'network_article_sources',
    'network_article_links',
    'network_content_publications',
    'network_ai_cost_log'
  ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.network_is_admin())', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- --- 12. Public read for the three monorepo sites' published articles ---
--
-- YGO/OnePiece/Lorcana share this Supabase project with CN OS. Their
-- public /insights/[slug] pages need read access to published
-- network_articles. We ADD a scoped select policy that allows
-- anonymous reads of ONLY published articles — nothing else.

drop policy if exists network_articles_public_published_select on public.network_articles;
create policy network_articles_public_published_select
  on public.network_articles
  for select
  using (status = 'published' and publication_target in ('ygo_db', 'onepiece_db', 'lorcana_db'));

-- --- 13. Touch triggers ------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_voice_profiles',
    'network_content_ideas',
    'network_content_briefs',
    'network_articles',
    'network_article_links'
  ])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.network_touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- --- 14. Article version autoincrement ---------------------------
--
-- Set version = (max existing + 1) atomically. Called from server
-- code when it decides to snapshot the current article state.

create or replace function public.network_snapshot_article(
  p_article_id uuid,
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
    from public.network_article_versions
   where article_id = p_article_id;

  -- Capture the current article state as a jsonb snapshot. Row-level
  -- security on this read is bypassed because we are a SECURITY
  -- INVOKER function running under the caller's session, so admin
  -- RLS applies naturally.
  select to_jsonb(a.*) into v_content
    from public.network_articles a
   where a.id = p_article_id;

  if v_content is null then
    raise exception 'network_snapshot_article: article % not found', p_article_id;
  end if;

  insert into public.network_article_versions
    (article_id, version, content, actor_type, actor_user_id, change_note)
  values
    (p_article_id, v_next, v_content, p_actor_type, p_actor_user_id, p_change_note)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.network_snapshot_article
  (uuid, public.network_actor_type, uuid, text)
  to authenticated, service_role;

-- --- 15. Seed voice profiles -------------------------------------
--
-- These seed the known positioning of each site. Updated through the
-- admin UI later (/admin/content/voice is scoped for a future block;
-- Phase 3 ships with seeded values).

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

  insert into public.network_voice_profiles
    (site_id, audience, tone, terminology, content_emphasis, preferred_structure, balance, do_not, naming_rules, canonical_tag, example_openings)
  values
    (v_pokemon,
     'English-language Pokémon TCG collectors (UK/EU focus) + modern value trackers. Mix of long-time collectors and modern-era investors.',
     'Precise, grounded, collector-first. Numbers must come from live PokePrices data. Avoid breathless hype language.',
     'Use "Pokémon TCG" with the accent. Use "card" not "monster card". Use set codes in parentheses on first mention: "Base Set (BS)". Grades: PSA 10, BGS 9.5, CGC 10. Use "chase cards" sparingly; prefer "high-grade" / "sealed" / "first edition" accurate language.',
     'Modern market movements, graded card dynamics, set-opening EVs, promo scarcity, Japan-vs-English pricing. 70% collector-market, 30% gameplay-adjacent (Standard rotation, World Championships).',
     'Lede → data snapshot → 3–5 H2 sections anchored on live data → "What this means for collectors" close → clean internal link block.',
     '70% collector / 30% gameplay-adjacent',
     'Do not invent prices, pop reports, release dates, or grading-service claims. Do not speculate about auction outcomes.',
     'Pokémon (with accent é) · Pokémon TCG · never "Pokemon TCG". Set codes in parens on first mention.',
     'Pokémon TCG',
     '["The hobby settled into a quiet week.", "Three graded Charizards changed the top of the ranking today.", "Promos remain the Pokémon market''s most under-tracked segment."]'::jsonb),
    (v_mtg,
     'Magic: The Gathering collectors AND competitive players — the two audiences overlap. Deck-building content must respect format currency; collector content must respect reprint history and finish nuance.',
     'Precise, inclusive, format-aware. 50/50 collector + gameplay balance. Never write for "a casual observer".',
     'Use "Magic: The Gathering" or "MTG". Set codes in parens: "The Lord of the Rings: Tales of Middle-earth (LTR)". Finishes: nonfoil, foil, etched, textured — these are distinct. Treatments (showcase, extended-art, borderless) are not rarities. Formats: Standard, Modern, Legacy, Vintage, Commander, Pauper, Pioneer.',
     'Deck archetypes, format metagame, printing/finish/treatment differences, reserved list, reprint cycles, Commander-first content, draft and limited.',
     'Open with the player question → data/evidence → 2–4 H2 sections mixing deck + market lenses → close with "What to do next" link block.',
     '50% collector / 50% gameplay',
     'Do not conflate finish with treatment or rarity. Do not predict future reprints. Do not fabricate ban-list dates or format legality.',
     'Magic: The Gathering · MTG · never "Magic the Gathering" without colon. Scryfall-canonical card names.',
     'Magic: The Gathering',
     '["Standard rotated yesterday and three Commander staples got cheaper.", "The reserved list did not move this week, but LTR Lord of the Rings foils did.", "A new printing of a staple is the fastest way to compress its market."]'::jsonb),
    (v_ygo,
     'Yu-Gi-Oh! collectors chasing rare printings and era pieces. Secondary audience is lapsed players returning for Legacy/Goat Format nostalgia.',
     'Precise, era-aware, collector-focused. Yu-Gi-Oh! has decades of printing history — never flatten it.',
     'Use "Yu-Gi-Oh!" with the exclamation mark. Set codes (LOB, PSV, LOD, etc.) in parens on first mention. Rarities include Secret, Ultra, Super, Ultimate, Ghost, Starlight, Prismatic Secret, Collector''s, Quarter Century. Editions: Unlimited, 1st Edition, Limited Edition, Promo. "Printing" is set × rarity × edition — these are three independent axes.',
     'Chase printings, rarity dynamics, era differences (TCG vs OCG, Legend-era vs modern), 1st Edition premiums, Prismatic chase odds, Secret Rare market behaviour.',
     'Open with the printing or market observation → ground in live price data → section per angle (era / rarity / edition) → close with navigation into catalogue.',
     '80% collector / 20% nostalgic-player',
     'Do not invent Konami announcements, Secret Rare pull rates, or tournament outcomes. Do not confuse OCG and TCG printings.',
     'Yu-Gi-Oh! (with exclamation) · never "Yugioh" in body copy. Treat Konami as the publisher.',
     'Yu-Gi-Oh!',
     '["LOB Ultra Rares moved first this week.", "Three Secret Rares landed on the top of the ranking.", "Prismatic Secret Rares remain the chase layer."]'::jsonb),
    (v_onepiece,
     'One Piece TCG collectors — primarily anime fans entering TCG, plus English-market players tracking releases from OP01 forward.',
     'Narrative-aware, character-first, release-cycle fluent. Treats the Bandai release cadence as a first-class concept.',
     'Use "One Piece Card Game" or "One Piece TCG". Set codes OP01, OP02, etc. Alt art, manga rare, parallel, super rare, secret rare are distinct treatments. Leaders are a card type, not a rarity.',
     'Leader-first deckbuilding, alt-art chase cards, Bandai release cadence (OP09 onwards), character-centric collecting (Luffy, Zoro, Nami cards across sets).',
     'Open with a character or set observation → data → sections mixing collecting + deckbuilding → close with character-page internal links.',
     '60% collector / 40% gameplay',
     'Do not predict Bandai reprints or future set contents. Do not invent English-release dates for OCG-only product.',
     'One Piece Card Game · One Piece TCG · Bandai as publisher. Character names in canonical English spelling (Luffy not Luffi).',
     'One Piece TCG',
     '["Luffy leaders moved up the ranking this week.", "OP09 alt arts settled into a tight band.", "A new set code just lifted three parallels onto the top of the market."]'::jsonb),
    (v_lorcana,
     'Disney Lorcana collectors — Disney IP fans and TCG collectors. Chapter-release aware. Enchanted-chasing is central.',
     'Narrative-aware, Disney-fluent, chapter-release-aware. Comfortable talking about franchise and treatment in the same breath.',
     'Use "Disney Lorcana". Inks: Amber, Amethyst, Emerald, Ruby, Sapphire, Steel. Rarities: Common, Uncommon, Rare, Super Rare, Legendary, Enchanted, Iconic. Treatments: nonfoil, cold foil, cold-foil Enchanted. Chapters: Chapter 1 (The First Chapter / TFC), Chapter 2 (Rise of the Floodborn), etc.',
     'Enchanted chase cards, chapter-release milestones, character-based collecting, Disney-IP sub-themes, ink combinations, deck balance.',
     'Open with character or ink angle → data → chapter/franchise context → close with character-page internal links.',
     '70% collector / 30% deckbuilding',
     'Do not invent Enchanted pull rates, Ravensburger announcements, or chapter release dates. Treat Disney IP respectfully.',
     'Disney Lorcana · Ravensburger as publisher. Chapter names in full on first mention.',
     'Disney Lorcana',
     '["Enchanted chase cards led the ranking this week.", "The new chapter dropped three new characters into the top of the market.", "Amber-ink decks remain the most tradable in the current meta."]'::jsonb)
  on conflict (site_id) do update
    set audience = excluded.audience,
        tone = excluded.tone,
        terminology = excluded.terminology,
        content_emphasis = excluded.content_emphasis,
        preferred_structure = excluded.preferred_structure,
        balance = excluded.balance,
        do_not = excluded.do_not,
        naming_rules = excluded.naming_rules,
        canonical_tag = excluded.canonical_tag,
        example_openings = excluded.example_openings,
        updated_at = now();
end $$;

-- --- 16. Register content job data source ------------------------
insert into public.network_data_sources (code, display_name, category, description)
values
  ('ai_claude', 'Claude (Anthropic)', 'external', 'AI assistance for briefs and drafts via Anthropic API')
on conflict (code) do nothing;
