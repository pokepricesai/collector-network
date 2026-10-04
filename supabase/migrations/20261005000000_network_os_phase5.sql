-- =============================================================
-- Collector Network OS — Phase 5: Revenue + Partner CRM
-- =============================================================
--
-- Goal: turn five specialist sites into one commercial operating
-- surface.
--
--   TRAFFIC  →  COMMERCIAL OPPORTUNITY  →  PARTNER / AFFILIATE / SPONSOR
--     →  OUTREACH / PLACEMENT  →  REVENUE  →  ATTRIBUTION
--     →  PERFORMANCE  →  NEXT ACTION
--
-- Design principles (all derived from the Phase 5 brief):
--
--   * Revenue is captured as discrete *events* — a conversion, a
--     sponsor invoice, a manual CSV import row, an ad-net payout.
--     Nothing is inferred. A click is not a conversion. A pipeline
--     deal is not booked revenue.
--
--   * Sources are generic strings keyed in a reference table so new
--     channels (whatnot, grading_partner, …) do not need schema
--     changes.
--
--   * Costs are already partially captured: AI in network_ai_cost_log
--     and BigQuery in network_job_runs.metadata.bq_est_cost_usd.
--     We do NOT duplicate those ledgers. We add:
--       - network_operating_costs: direct opex not captured elsewhere
--         (hosting, Supabase, domain, external SaaS, tools).
--       - network_cost_daily:      justified normalised daily rollup
--         joining all three sources into one site/day row for the
--         dashboard and contribution-profit view.
--
--   * Partner CRM is operational, not Salesforce-sized. One partner
--     has many contacts, many interactions, many opportunities. One
--     opportunity can become one sponsorship with reusable
--     deliverables. All multi-site deals (e.g. £300/mo × 12mo across
--     3 sites) are first-class via sponsorship_sites + per-site
--     deliverable scoping.
--
--   * Append-only where the signal matters (clicks, conversions,
--     revenue events, interactions). Mutable where state is
--     authoritative (partner profile, pipeline stage, offer catalogue).
--
--   * RLS admin-only on everything. No consumer surfaces touch any
--     of these tables. Public-site click ingest (added later) writes
--     via service role only.
--
--   * No autonomous outreach. No emails sent. No sponsor contacted.
--     Status transitions on partners and sponsorships are human-
--     driven. "contacted" means the admin logged that they
--     contacted the partner — the system does NOT send messages.

-- --- 1. Enums ---------------------------------------------------

do $$
begin
  create type public.network_revenue_source_kind as enum (
    'ebay_epn',
    'impact_tcgplayer',
    'tcgplayer_direct',
    'whatnot',
    'display_ads',
    'sponsorship',
    'premium_listing',
    'grading_partner',
    'direct_advertising',
    'manual',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_partner_kind as enum (
    'grading_company',
    'lgs',
    'marketplace',
    'scanner_tool',
    'accessory',
    'storage',
    'auction',
    'vendor',
    'content_creator',
    'event',
    'tcgplayer_direct',
    'ebay',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_partner_status as enum (
    'prospect',
    'researching',
    'ready_to_contact',
    'contacted',
    'replied',
    'meeting',
    'proposal',
    'negotiating',
    'won',
    'lost',
    'nurture',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_sponsorship_status as enum (
    'draft',       -- being modelled, no partner commitment
    'proposed',    -- offer sent, awaiting response
    'accepted',    -- verbal / written yes, not yet live
    'active',      -- live placement
    'renewing',    -- renewal in-flight within 30 days of end
    'paused',      -- temporarily off
    'ended',       -- normal end-of-term
    'cancelled'    -- early termination
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_interaction_kind as enum (
    'email_sent',
    'email_received',
    'call',
    'meeting',
    'dm',
    'note',
    'proposal_sent',
    'proposal_received',
    'contract_sent',
    'contract_signed',
    'invoice_sent',
    'payment_received',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_opportunity_kind as enum (
    'affiliate_optimisation',
    'placement_test',
    'new_source',
    'underperforming_source',
    'sponsor_renewal_due',
    'sponsor_prospect',
    'offer_gap',
    'ctr_anomaly',
    'revenue_gap_vs_traffic',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$
begin
  create type public.network_opportunity_status as enum (
    'open', 'in_progress', 'dismissed', 'resolved'
  );
exception when duplicate_object then null; end $$;

-- --- 2. Reference: revenue sources ------------------------------
--
-- One row per logical revenue channel. Site-independent catalogue.
-- Sources carry their *kind* so dashboards can group ("Affiliate"
-- vs "Sponsorship" vs "Ads") without hard-coding slugs anywhere.

create table if not exists public.network_revenue_sources (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z][a-z0-9_]*$' and length(slug) between 2 and 48),
  display_name    text not null,
  kind            public.network_revenue_source_kind not null,
  provider        text,                             -- e.g. 'eBay Partner Network'
  external_portal_url text,                         -- read-only pointer
  default_currency text not null default 'GBP'
                  check (char_length(default_currency) = 3),
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists network_revenue_sources_kind_idx
  on public.network_revenue_sources (kind, is_active);

-- --- 3. Core revenue event (append-only) ------------------------
--
-- One row per observed revenue signal. This is the atomic unit; all
-- aggregates derive from here. We never update a row — correcting
-- an entry means inserting an offsetting row with reversal_of = <id>.
--
-- occurred_on is the business date (what the revenue is *for*),
-- recorded_at is when we captured it.
--
-- amount_minor is in the smallest currency unit of `currency` (pence
-- for GBP, cents for USD) to avoid float drift. Dashboards divide
-- by 100.
--
-- `source_detail` carries the free-form reference the external
-- provider gave us (EPN batch id, Impact invoice id, sponsor PO,
-- manual-entry note).

create table if not exists public.network_revenue_events (
  id               uuid primary key default gen_random_uuid(),
  source_id        uuid not null references public.network_revenue_sources (id)
                   on delete restrict,
  site_id          uuid references public.network_sites (id) on delete set null,
  -- For multi-site sponsorship events, the sponsorship_id anchors
  -- the deal and site_id names the specific site this slice is
  -- attributed to. Both nullable because manual entries may be
  -- network-wide.
  sponsorship_id   uuid,                            -- fk added later (after sponsorships table)
  partner_id       uuid,                            -- fk added later (after partners table)

  event_kind       text not null default 'revenue'
                   check (event_kind in ('revenue', 'refund', 'adjustment', 'reversal')),
  occurred_on      date not null,
  amount_minor     bigint not null,                 -- can be negative for refunds/reversals
  currency         text not null default 'GBP'
                   check (char_length(currency) = 3),

  description      text,
  source_detail    jsonb not null default '{}'::jsonb,
  external_ref     text,                            -- e.g. EPN report batch id, invoice no.
  reversal_of      uuid references public.network_revenue_events (id)
                   on delete set null,

  entered_by       uuid references public.network_admin_users (id) on delete set null,
  idempotency_key  text,                            -- for CSV imports / API ingestion
  recorded_at      timestamptz not null default now(),
  unique (source_id, idempotency_key)
);

create index if not exists network_revenue_events_occurred_idx
  on public.network_revenue_events (occurred_on desc);
create index if not exists network_revenue_events_site_date_idx
  on public.network_revenue_events (site_id, occurred_on desc);
create index if not exists network_revenue_events_source_date_idx
  on public.network_revenue_events (source_id, occurred_on desc);
create index if not exists network_revenue_events_partner_idx
  on public.network_revenue_events (partner_id)
  where partner_id is not null;
create index if not exists network_revenue_events_sponsorship_idx
  on public.network_revenue_events (sponsorship_id)
  where sponsorship_id is not null;

-- --- 4. Daily revenue rollup ------------------------------------
--
-- Pre-aggregated per site × source × currency × date for fast
-- dashboard rendering. Rebuilt by a deterministic rollup job; never
-- hand-edited. Idempotent via the composite unique key.

create table if not exists public.network_revenue_daily (
  id              uuid primary key default gen_random_uuid(),
  for_date        date not null,
  site_id         uuid references public.network_sites (id) on delete cascade,
  source_id       uuid not null references public.network_revenue_sources (id)
                  on delete cascade,
  currency        text not null,
  gross_minor     bigint not null default 0,         -- sum of revenue events
  refunds_minor   bigint not null default 0,
  net_minor       bigint not null default 0,
  event_count     integer not null default 0,
  computed_at     timestamptz not null default now(),
  unique (for_date, site_id, source_id, currency)
);

create index if not exists network_revenue_daily_for_date_idx
  on public.network_revenue_daily (for_date desc);
create index if not exists network_revenue_daily_site_idx
  on public.network_revenue_daily (site_id, for_date desc);

-- --- 5. Affiliate click (append-only, bounded) -------------------
--
-- Written by site-side ingest routes (phase F) for YGO / OP /
-- Lorcana. PokePrices continues to write to its own affiliate_events
-- table in its own project; a later importer may normalise rows
-- into here. MTGPrices is not click-tracked in Phase 5.
--
-- Privacy mirrored from PokePrices precedent: no IP, no UA, no
-- Referer, no email, no user_id. session_id is optional and only
-- stored when the client supplies one.

create table if not exists public.network_affiliate_clicks (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.network_sites (id) on delete cascade,
  source_id       uuid references public.network_revenue_sources (id) on delete set null,

  placement       text not null
                  check (length(placement) between 1 and 80
                         and placement ~ '^[A-Za-z0-9_:.-]+$'),
  page_type       text check (page_type is null or length(page_type) <= 40),
  source_component text check (source_component is null or length(source_component) <= 80),
  card_slug       text check (card_slug is null or length(card_slug) <= 80),
  set_slug        text check (set_slug is null or length(set_slug) <= 200),
  intent          text check (intent is null or length(intent) <= 40),
  marketplace     text check (marketplace is null or length(marketplace) <= 8),
  session_id      text check (session_id is null or length(session_id) <= 64),

  occurred_at     timestamptz not null default now()
);

create index if not exists network_affiliate_clicks_site_time_idx
  on public.network_affiliate_clicks (site_id, occurred_at desc);
create index if not exists network_affiliate_clicks_placement_idx
  on public.network_affiliate_clicks (placement, occurred_at desc);
create index if not exists network_affiliate_clicks_source_time_idx
  on public.network_affiliate_clicks (source_id, occurred_at desc);

-- --- 6. Affiliate conversion -------------------------------------
--
-- Deliberately *separate* from clicks. Rows are imported from EPN /
-- Impact / Whatnot reports (manual CSV in Phase 5). A conversion is
-- never inferred from a click; even when the provider gives us a
-- click id, we store the pairing explicitly as `click_id` and
-- `provider_click_id` and leave both nullable.

create table if not exists public.network_affiliate_conversions (
  id                 uuid primary key default gen_random_uuid(),
  source_id          uuid not null references public.network_revenue_sources (id)
                     on delete restrict,
  site_id            uuid references public.network_sites (id) on delete set null,
  click_id           uuid references public.network_affiliate_clicks (id) on delete set null,
  revenue_event_id   uuid references public.network_revenue_events (id) on delete set null,

  provider_click_id  text,
  provider_order_id  text,
  occurred_on        date not null,
  amount_minor       bigint not null default 0,
  currency           text not null default 'GBP' check (char_length(currency) = 3),
  provider_payload   jsonb not null default '{}'::jsonb,

  idempotency_key    text,
  recorded_at        timestamptz not null default now(),
  unique (source_id, idempotency_key)
);

create index if not exists network_affiliate_conversions_date_idx
  on public.network_affiliate_conversions (occurred_on desc);
create index if not exists network_affiliate_conversions_site_date_idx
  on public.network_affiliate_conversions (site_id, occurred_on desc);

-- --- 7. Partner directory ---------------------------------------

create table if not exists public.network_partners (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique
                     check (slug ~ '^[a-z][a-z0-9_-]*$' and length(slug) between 2 and 80),
  display_name       text not null,
  kind               public.network_partner_kind not null,
  status             public.network_partner_status not null default 'prospect',
  website            text,
  description        text,
  countries          text[] not null default '{}'::text[],
  tags               text[] not null default '{}'::text[],
  priority           smallint not null default 3 check (priority between 1 and 5),
  owner_user_id      uuid references public.network_admin_users (id) on delete set null,
  next_action        text,
  next_action_due    date,
  last_contact_at    timestamptz,
  intro_source       text,                          -- how we met them
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists network_partners_status_idx
  on public.network_partners (status, priority);
create index if not exists network_partners_kind_idx
  on public.network_partners (kind);
create index if not exists network_partners_next_action_idx
  on public.network_partners (next_action_due)
  where next_action_due is not null;

-- --- 8. Partner contacts ----------------------------------------

create table if not exists public.network_partner_contacts (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.network_partners (id)
                on delete cascade,
  full_name     text not null,
  role_title    text,
  email         text,
  phone         text,
  linkedin      text,
  twitter       text,
  is_primary    boolean not null default false,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists network_partner_contacts_partner_idx
  on public.network_partner_contacts (partner_id);
create unique index if not exists network_partner_contacts_primary_idx
  on public.network_partner_contacts (partner_id)
  where is_primary;

-- --- 9. Partner interactions (append-only) -----------------------

create table if not exists public.network_partner_interactions (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid not null references public.network_partners (id)
                on delete cascade,
  contact_id    uuid references public.network_partner_contacts (id)
                on delete set null,
  opportunity_id uuid,                              -- fk added later
  sponsorship_id uuid,                              -- fk added later
  kind          public.network_interaction_kind not null,
  direction     text not null default 'outbound'
                check (direction in ('outbound', 'inbound', 'internal')),
  summary       text not null,
  detail        text,
  external_ref  text,
  occurred_at   timestamptz not null default now(),
  logged_by     uuid references public.network_admin_users (id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists network_partner_interactions_partner_time_idx
  on public.network_partner_interactions (partner_id, occurred_at desc);
create index if not exists network_partner_interactions_kind_idx
  on public.network_partner_interactions (kind, occurred_at desc);

-- --- 10. Commercial offer catalogue ------------------------------
--
-- Reusable building blocks. One offer describes a deliverable at a
-- fixed price point. Deals (sponsorships) assemble these.

create table if not exists public.network_commercial_offers (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique
                  check (slug ~ '^[a-z][a-z0-9_-]*$' and length(slug) between 2 and 64),
  display_name    text not null,
  category        text not null,                    -- 'placement', 'content', 'data', 'premium_listing', 'graded_cta', 'bundle', 'other'
  description     text,
  default_scope   text not null default 'single_site'
                  check (default_scope in ('single_site', 'multi_site', 'network_wide')),
  default_unit    text not null default 'month'
                  check (default_unit in ('month', 'quarter', 'year', 'one_off', 'cpm', 'cpc', 'revshare')),
  default_price_minor bigint,                        -- rate card indication; nullable
  default_currency text not null default 'GBP'
                  check (char_length(default_currency) = 3),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists network_commercial_offers_category_idx
  on public.network_commercial_offers (category, is_active);

-- --- 11. Sponsorships (deal header) ------------------------------
--
-- A deal with a specific partner for a specific term. Supports
-- multi-site through network_sponsorship_sites. Supports arbitrary
-- deliverable mixes through network_sponsorship_deliverables.
--
-- This models the Imperium-type archetype generically:
--   - partner_id = any grading company (not hard-coded)
--   - term_months = 12
--   - total_value_minor = 300 * 12 * 100  (£300 × 12mo = £3600 → 360000 pence)
--   - billing_cadence = 'monthly'
--   - deliverables: graded_cta + premium_listing + homepage_banner +
--                   data_integration + articles (any subset of the
--                   catalogue)
--   - sites: any subset of pokemon / mtg / ygo / onepiece / lorcana

create table if not exists public.network_sponsorships (
  id                  uuid primary key default gen_random_uuid(),
  partner_id          uuid not null references public.network_partners (id)
                      on delete restrict,
  title               text not null,                -- short internal label
  status              public.network_sponsorship_status not null default 'draft',

  starts_on           date,
  ends_on             date,
  term_months         integer check (term_months is null or term_months > 0),

  total_value_minor   bigint not null default 0,
  currency            text not null default 'GBP'
                      check (char_length(currency) = 3),
  billing_cadence     text not null default 'monthly'
                      check (billing_cadence in ('one_off', 'monthly', 'quarterly', 'annually', 'milestone')),

  renewal_reminder_on date,                         -- derived to 30d before ends_on by default
  signed_at           timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,

  notes               text,
  metadata            jsonb not null default '{}'::jsonb,
  created_by          uuid references public.network_admin_users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists network_sponsorships_partner_idx
  on public.network_sponsorships (partner_id);
create index if not exists network_sponsorships_status_idx
  on public.network_sponsorships (status);
create index if not exists network_sponsorships_renewal_idx
  on public.network_sponsorships (renewal_reminder_on)
  where renewal_reminder_on is not null and status in ('active', 'renewing');
create index if not exists network_sponsorships_ends_idx
  on public.network_sponsorships (ends_on)
  where ends_on is not null;

-- --- 12. Sponsorship sites (M:N) ---------------------------------

create table if not exists public.network_sponsorship_sites (
  sponsorship_id  uuid not null references public.network_sponsorships (id)
                  on delete cascade,
  site_id         uuid not null references public.network_sites (id)
                  on delete restrict,
  value_share     numeric(6, 4) not null default 0  -- 0..1 fraction of total_value
                  check (value_share >= 0 and value_share <= 1),
  primary key (sponsorship_id, site_id)
);

-- --- 13. Sponsorship deliverables --------------------------------
--
-- One row per concrete thing the partner is receiving. Links to the
-- catalogue entry when possible but keeps a frozen display label
-- + custom notes so dashboard history survives offer catalogue edits.

create table if not exists public.network_sponsorship_deliverables (
  id              uuid primary key default gen_random_uuid(),
  sponsorship_id  uuid not null references public.network_sponsorships (id)
                  on delete cascade,
  offer_id        uuid references public.network_commercial_offers (id)
                  on delete set null,
  site_id         uuid references public.network_sites (id)
                  on delete set null,              -- null means network-wide

  display_name    text not null,                   -- frozen label
  category        text not null,                   -- frozen category
  quantity        integer not null default 1 check (quantity > 0),
  placement_hint  text,                            -- e.g. 'homepage header', 'graded-value CTA'
  status          text not null default 'planned'
                  check (status in ('planned', 'in_setup', 'live', 'paused', 'ended')),
  live_from       date,
  live_until      date,
  evidence_url    text,                            -- read-only pointer to proof-of-placement doc
  notes           text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists network_sponsorship_deliverables_sponsorship_idx
  on public.network_sponsorship_deliverables (sponsorship_id);
create index if not exists network_sponsorship_deliverables_site_idx
  on public.network_sponsorship_deliverables (site_id);

-- --- 14. Opportunities -------------------------------------------
--
-- Deterministic engine populates these. UI lets admin promote one
-- into a network_task. We keep both: opportunity = finding;
-- network_task = commitment to act.

create table if not exists public.network_partner_opportunities (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid references public.network_partners (id) on delete set null,
  site_id         uuid references public.network_sites (id) on delete set null,
  sponsorship_id  uuid references public.network_sponsorships (id) on delete set null,
  source_id       uuid references public.network_revenue_sources (id) on delete set null,

  kind            public.network_opportunity_kind not null,
  status          public.network_opportunity_status not null default 'open',
  severity        text not null default 'normal'
                  check (severity in ('critical', 'high', 'normal', 'low')),
  title           text not null,
  rationale       text not null,
  evidence        jsonb not null default '{}'::jsonb,
  dedupe_key      text not null,                   -- stable key so re-runs don't duplicate
  task_id         uuid references public.network_tasks (id) on delete set null,
  resolved_at     timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists network_partner_opportunities_status_idx
  on public.network_partner_opportunities (status, severity);
create index if not exists network_partner_opportunities_partner_idx
  on public.network_partner_opportunities (partner_id)
  where partner_id is not null;

-- --- 15. Operating costs (direct opex only) ----------------------
--
-- Opex NOT already captured in network_ai_cost_log or
-- network_job_runs.metadata.bq_est_cost_usd. Hosting, Supabase,
-- domain renewals, external SaaS. Manual entry with an attributable
-- site_id when applicable.

create table if not exists public.network_operating_costs (
  id              uuid primary key default gen_random_uuid(),
  for_date        date not null,
  site_id         uuid references public.network_sites (id) on delete set null,
  category        text not null,                   -- 'hosting', 'supabase', 'domain', 'saas', 'tool', 'other'
  provider        text,
  description     text,
  amount_minor    bigint not null,
  currency        text not null default 'GBP'
                  check (char_length(currency) = 3),
  external_ref    text,
  entered_by      uuid references public.network_admin_users (id) on delete set null,
  idempotency_key text unique,
  created_at      timestamptz not null default now()
);

create index if not exists network_operating_costs_for_date_idx
  on public.network_operating_costs (for_date desc);
create index if not exists network_operating_costs_site_date_idx
  on public.network_operating_costs (site_id, for_date desc);

-- --- 16. Daily cost rollup ---------------------------------------
--
-- Normalised join of three sources: AI, BigQuery, direct opex.
-- Written by a deterministic rollup. Fuels the contribution-profit
-- view without each dashboard needing to re-join three tables.

create table if not exists public.network_cost_daily (
  id              uuid primary key default gen_random_uuid(),
  for_date        date not null,
  site_id         uuid references public.network_sites (id) on delete cascade,
  currency        text not null default 'GBP',
  ai_cost_minor      bigint not null default 0,     -- from network_ai_cost_log (converted)
  bq_cost_minor      bigint not null default 0,     -- from network_job_runs.metadata.bq_est_cost_usd (converted)
  ops_cost_minor     bigint not null default 0,     -- from network_operating_costs
  total_cost_minor   bigint not null default 0,
  computed_at     timestamptz not null default now(),
  unique (for_date, site_id, currency)
);

create index if not exists network_cost_daily_for_date_idx
  on public.network_cost_daily (for_date desc);
create index if not exists network_cost_daily_site_idx
  on public.network_cost_daily (site_id, for_date desc);

-- --- 17. Profit snapshots ----------------------------------------
--
-- Append-only contribution-profit snapshots. Each row freezes the
-- state at a point in time so dashboards can show trend without
-- recomputing. Contribution profit only — not statutory accounting.

create table if not exists public.network_profit_snapshots (
  id              uuid primary key default gen_random_uuid(),
  for_period_start date not null,
  for_period_end   date not null,
  site_id         uuid references public.network_sites (id) on delete cascade,
  currency        text not null default 'GBP',
  revenue_minor         bigint not null default 0,
  direct_cost_minor     bigint not null default 0,
  contribution_minor    bigint not null default 0,  -- revenue - direct_cost
  computed_at     timestamptz not null default now(),
  methodology     text,                             -- short freeze note
  evidence        jsonb not null default '{}'::jsonb
);

create index if not exists network_profit_snapshots_period_idx
  on public.network_profit_snapshots (for_period_end desc);
create index if not exists network_profit_snapshots_site_idx
  on public.network_profit_snapshots (site_id, for_period_end desc);

-- --- 18. Deferred FKs now that referenced tables exist -----------

alter table public.network_revenue_events
  drop constraint if exists network_revenue_events_sponsorship_fk,
  add constraint network_revenue_events_sponsorship_fk
    foreign key (sponsorship_id) references public.network_sponsorships (id)
    on delete set null;

alter table public.network_revenue_events
  drop constraint if exists network_revenue_events_partner_fk,
  add constraint network_revenue_events_partner_fk
    foreign key (partner_id) references public.network_partners (id)
    on delete set null;

alter table public.network_partner_interactions
  drop constraint if exists network_partner_interactions_opportunity_fk,
  add constraint network_partner_interactions_opportunity_fk
    foreign key (opportunity_id) references public.network_partner_opportunities (id)
    on delete set null;

alter table public.network_partner_interactions
  drop constraint if exists network_partner_interactions_sponsorship_fk,
  add constraint network_partner_interactions_sponsorship_fk
    foreign key (sponsorship_id) references public.network_sponsorships (id)
    on delete set null;

-- --- 19. RLS enablement + policies -------------------------------

alter table public.network_revenue_sources           enable row level security;
alter table public.network_revenue_events            enable row level security;
alter table public.network_revenue_daily             enable row level security;
alter table public.network_affiliate_clicks          enable row level security;
alter table public.network_affiliate_conversions     enable row level security;
alter table public.network_partners                  enable row level security;
alter table public.network_partner_contacts          enable row level security;
alter table public.network_partner_interactions      enable row level security;
alter table public.network_commercial_offers         enable row level security;
alter table public.network_sponsorships              enable row level security;
alter table public.network_sponsorship_sites         enable row level security;
alter table public.network_sponsorship_deliverables  enable row level security;
alter table public.network_partner_opportunities     enable row level security;
alter table public.network_operating_costs           enable row level security;
alter table public.network_cost_daily                enable row level security;
alter table public.network_profit_snapshots          enable row level security;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_revenue_sources',
    'network_revenue_events',
    'network_revenue_daily',
    'network_affiliate_clicks',
    'network_affiliate_conversions',
    'network_partners',
    'network_partner_contacts',
    'network_partner_interactions',
    'network_commercial_offers',
    'network_sponsorships',
    'network_sponsorship_sites',
    'network_sponsorship_deliverables',
    'network_partner_opportunities',
    'network_operating_costs',
    'network_cost_daily',
    'network_profit_snapshots'
  ])
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.network_is_admin())', t || '_admin_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all using (public.network_is_admin()) with check (public.network_is_admin())', t || '_admin_write', t);
  end loop;
end $$;

-- --- 20. Seed reference data: revenue sources --------------------

insert into public.network_revenue_sources (slug, display_name, kind, provider, default_currency, notes)
values
  ('ebay_epn_uk',          'eBay UK (EPN)',               'ebay_epn',          'eBay Partner Network', 'GBP', 'UK marketplace affiliate revenue'),
  ('ebay_epn_us',          'eBay US (EPN)',               'ebay_epn',          'eBay Partner Network', 'USD', 'US marketplace affiliate revenue'),
  ('impact_tcgplayer',     'TCGplayer via Impact',        'impact_tcgplayer',  'Impact.com',           'USD', 'MTG primary affiliate channel'),
  ('tcgplayer_direct',     'TCGplayer (direct)',          'tcgplayer_direct',  'TCGplayer',            'USD', 'Direct TCGplayer affiliate when not via Impact'),
  ('whatnot',              'Whatnot',                     'whatnot',           'Whatnot',              'USD', 'Live auction affiliate / referral'),
  ('display_ads',          'Display ads (manual)',        'display_ads',       null,                   'GBP', 'Ad network payouts entered manually'),
  ('sponsorship_default',  'Sponsorship revenue',         'sponsorship',       null,                   'GBP', 'Direct sponsor payments'),
  ('premium_listing',      'Premium vendor listings',     'premium_listing',   null,                   'GBP', 'Vendor paid-placement listings'),
  ('grading_partner',      'Grading company partnership', 'grading_partner',   null,                   'GBP', 'Grading-specific partnership income'),
  ('direct_advertising',   'Direct advertising',          'direct_advertising',null,                   'GBP', 'Direct banner/CPM arrangement'),
  ('manual_other',         'Manual / other',              'manual',            null,                   'GBP', 'Catch-all manual-entry channel')
on conflict (slug) do nothing;

-- --- 21. Seed reference data: commercial offer catalogue ---------

insert into public.network_commercial_offers
  (slug, display_name, category, description, default_scope, default_unit, default_price_minor, default_currency)
values
  ('graded_cta',          'Graded-price CTA',            'graded_cta',       'Prominent call-to-action on graded-price panels linking to partner', 'single_site', 'month', 10000,  'GBP'),
  ('homepage_banner',     'Homepage banner',             'placement',        'Above-the-fold banner on specialist-site homepage',                 'single_site', 'month', 20000,  'GBP'),
  ('premium_listing',     'Premium vendor listing',      'premium_listing',  'Top-of-category vendor listing with enhanced metadata',             'single_site', 'month', 15000,  'GBP'),
  ('data_integration',    'Data / pricing integration',  'data',             'Partner pricing feed integrated into pricing surfaces',             'network_wide','month', 25000,  'GBP'),
  ('sponsored_article',   'Sponsored editorial',         'content',          'Useful editorial article tagged as sponsored',                      'single_site', 'one_off', 30000,'GBP'),
  ('newsletter_mention',  'Newsletter mention',          'content',          'Section mention in weekly newsletter',                              'network_wide','one_off', 5000, 'GBP'),
  ('category_sponsor',    'Category sponsorship',        'placement',        'Sponsor badge + attribution across a game category',                'single_site', 'month', 20000,  'GBP'),
  ('bundle_multisite',    'Multi-site bundle',           'bundle',           'Container for a multi-site deal; priced per deal',                  'multi_site',  'month', null,   'GBP')
on conflict (slug) do nothing;

-- --- 22. Helper: default renewal reminder trigger ----------------
--
-- Keeps renewal_reminder_on = ends_on - 30 days when ends_on is set
-- and the admin did not override.

create or replace function public.network_sponsorship_set_renewal_reminder()
returns trigger
language plpgsql
as $$
begin
  if new.ends_on is not null and new.renewal_reminder_on is null then
    new.renewal_reminder_on := new.ends_on - interval '30 days';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists network_sponsorship_renewal_reminder_trg on public.network_sponsorships;
create trigger network_sponsorship_renewal_reminder_trg
  before insert or update on public.network_sponsorships
  for each row execute function public.network_sponsorship_set_renewal_reminder();

-- --- 23. updated_at touch trigger -------------------------------

create or replace function public.network_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'network_revenue_sources',
    'network_partners',
    'network_partner_contacts',
    'network_commercial_offers',
    'network_sponsorship_deliverables',
    'network_partner_opportunities'
  ])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.network_touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end $$;
