-- CN-06A: US TCG Vendor Sponsorship CRM
-- =============================================================
-- Extends the Phase-5 partner CRM with the fields and reference
-- tables needed to run a US-focused TCG sponsorship sales pipeline.
--
-- Design:
--   • EXTEND network_partners rather than build a parallel table.
--     We reuse contacts, interactions, offers, sponsorships,
--     deliverables and opportunities as-is.
--   • Add CN-06A-specific columns on network_partners (vendor
--     category, relevant TCGs, US state, fit score, research
--     provenance). All nullable so existing partner rows stay valid.
--   • New reference tables for the 16 vendor categories and the
--     outreach-template library. Both admin-managed, admin-only RLS.
--   • Deterministic 100-point scoring computed in a view so a change
--     to the formula requires no row rewrite.

-- 1. Extend network_partners -------------------------------------
--
-- Nullable columns only. Zero migration risk against existing data.

alter table public.network_partners
  add column if not exists vendor_category            text,
  add column if not exists vendor_subcategory         text,
  add column if not exists relevant_tcgs              text[] not null default '{}'::text[],
  add column if not exists us_state                   text,   -- ISO 2-letter or long name; nullable
  add column if not exists is_us_business             boolean not null default false,
  add column if not exists estimated_size             text,   -- 'small' | 'medium' | 'large' | null
  add column if not exists recommended_offer_id       uuid,   -- FK to crm_vendor_offers added after that table is created below
  add column if not exists recommended_price_minor    bigint,
  add column if not exists recommended_currency       text default 'GBP' check (recommended_currency is null or char_length(recommended_currency) = 3),
  add column if not exists fit_score                  integer check (fit_score is null or (fit_score between 0 and 100)),
  add column if not exists fit_score_breakdown        jsonb not null default '{}'::jsonb,
  add column if not exists research_sources           text[] not null default '{}'::text[],
  add column if not exists last_researched_at         timestamptz,
  add column if not exists research_confidence        text check (research_confidence in ('high','medium','low') or research_confidence is null),
  add column if not exists first_wave                 boolean not null default false;

comment on column public.network_partners.vendor_category is
  'CN-06A vendor category code (fk-soft to crm_vendor_categories.code). Narrower than network_partner_kind.';
comment on column public.network_partners.relevant_tcgs is
  'Which of pokemon/mtg/ygo/onepiece/lorcana this vendor is commercially relevant to.';
comment on column public.network_partners.research_sources is
  'URLs documenting the research trail. Required when fit_score is set.';
comment on column public.network_partners.first_wave is
  'Top-25 flag used by the admin "First-wave prospects" view.';

create index if not exists network_partners_vendor_category_idx
  on public.network_partners (vendor_category) where vendor_category is not null;
create index if not exists network_partners_us_business_idx
  on public.network_partners (is_us_business, fit_score desc) where is_us_business = true;
create index if not exists network_partners_first_wave_idx
  on public.network_partners (first_wave, fit_score desc) where first_wave = true;

-- 2. crm_vendor_categories (reference) ---------------------------

create table if not exists public.crm_vendor_categories (
  code                 text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  display_name         text not null,
  description          text not null,
  target_customer      text not null,
  why_tcg_audience     text not null,
  default_relevant_tcgs text[] not null default '{}'::text[],
  intro_price_minor    bigint not null,       -- entry-level sponsorship, in pence
  intro_price_currency text not null default 'GBP' check (char_length(intro_price_currency) = 3),
  premium_price_minor  bigint,                -- premium package, in pence
  is_active            boolean not null default true,
  sort_order           integer not null default 100,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table public.crm_vendor_categories enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='crm_vendor_categories'
  ) then
    create policy crm_vendor_categories_admin on public.crm_vendor_categories
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- 3. crm_vendor_offers (per-category offer catalog) --------------
--
-- Extends network_commercial_offers (which stores generic placements)
-- with the per-category sponsorship packages CN-06A sells. Each row
-- describes what the sponsor gets AND whether that placement is
-- already live on the sites or still requires development.

create table if not exists public.crm_vendor_offers (
  id                    uuid primary key default gen_random_uuid(),
  category_code         text not null references public.crm_vendor_categories (code) on delete restrict,
  slug                  text not null,
  display_name          text not null,
  description           text not null,
  placement_sites       text[] not null default '{}'::text[],  -- any of 'pokemon','mtg','ygo','onepiece','lorcana', or 'network'
  price_minor           bigint not null,
  price_currency        text not null default 'GBP' check (char_length(price_currency) = 3),
  term_months           integer not null default 12,
  tier                  text not null check (tier in ('entry','standard','premium')),
  is_live_capability    boolean not null default true,  -- false = requires development before we can deliver
  development_notes     text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (category_code, slug)
);

alter table public.crm_vendor_offers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='crm_vendor_offers'
  ) then
    create policy crm_vendor_offers_admin on public.crm_vendor_offers
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

create index if not exists crm_vendor_offers_category_idx
  on public.crm_vendor_offers (category_code, tier) where is_active = true;

-- Add the deferred FK from network_partners.recommended_offer_id → crm_vendor_offers.id
-- (deferred because crm_vendor_offers didn't exist when the column was added).
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'network_partners_recommended_offer_fk'
  ) then
    alter table public.network_partners
      add constraint network_partners_recommended_offer_fk
      foreign key (recommended_offer_id)
      references public.crm_vendor_offers (id)
      on delete set null;
  end if;
end $$;

-- 4. crm_outreach_templates --------------------------------------

create table if not exists public.crm_outreach_templates (
  id              uuid primary key default gen_random_uuid(),
  category_code   text references public.crm_vendor_categories (code) on delete set null,
  slug            text not null unique,
  subject_line    text not null,
  body_markdown   text not null,
  variables       text[] not null default '{}'::text[],  -- documented placeholders e.g. {{company_name}}
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.crm_outreach_templates enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='crm_outreach_templates'
  ) then
    create policy crm_outreach_templates_admin on public.crm_outreach_templates
      for all using (public.network_is_admin()) with check (public.network_is_admin());
  end if;
end $$;

-- 5. Add verification tracking to network_partner_contacts -------
--
-- CN-06A requires strict distinction between "publicly listed",
-- "technically validated" and "confirmed deliverability". The CRM
-- never manufactures emails from naming conventions.

alter table public.network_partner_contacts
  add column if not exists contact_url            text,         -- public contact form or /contact page
  add column if not exists email_verification     text          -- 'public_listed' | 'validated' | 'confirmed' | null
    check (email_verification is null or email_verification in ('public_listed','validated','confirmed')),
  add column if not exists email_verified_at      timestamptz,
  add column if not exists source_url             text,         -- where we found this contact publicly
  add column if not exists suppressed             boolean not null default false,
  add column if not exists suppressed_reason      text,
  add column if not exists suppressed_at          timestamptz,
  add column if not exists priority               integer check (priority is null or (priority between 1 and 5));

comment on column public.network_partner_contacts.email is
  'Email ONLY where publicly listed by the company. Never inferred from naming conventions.';
comment on column public.network_partner_contacts.email_verification is
  'public_listed = found on company site/directory; validated = SMTP/MX syntax ok; confirmed = delivered to in past outreach.';

-- 6. v_crm_vendor_scoring view -----------------------------------
--
-- Deterministic 100-point formula per CN-06A phase 6:
--     30 fit with audience                → relevant_tcgs ∩ core-5
--     25 commercial suitability           → estimated_size + category tier
--     20 placement relevance              → recommended_offer presence
--     15 contact route quality            → contact + email_verification
--     10 cross-TCG multi-site opportunity → cardinality(relevant_tcgs)
-- Live view so a formula change applies instantly.

create or replace view public.v_crm_vendor_scoring as
with contact_quality as (
  select partner_id,
         max(case email_verification
               when 'confirmed'     then 15
               when 'validated'     then 10
               when 'public_listed' then 8
               else case
                      when email is not null then 6
                      when contact_url is not null then 5
                      else 0
                    end
             end) as contact_pts
    from public.network_partner_contacts
   where suppressed = false
   group by partner_id
)
select p.id,
       p.display_name,
       p.vendor_category,
       p.relevant_tcgs,
       -- 30 points: audience fit
       least(30, cardinality(p.relevant_tcgs) * 8) as audience_pts,
       -- 25 points: commercial suitability
       (case p.estimated_size
          when 'large'   then 25
          when 'medium'  then 18
          when 'small'   then 10
          else 8
        end) as commercial_pts,
       -- 20 points: placement relevance
       (case
          when p.recommended_offer_id is not null then 20
          when p.vendor_category is not null      then 12
          else 4
        end) as placement_pts,
       -- 15 points: contact route quality (nulls → 0)
       coalesce(cq.contact_pts, 0) as contact_pts,
       -- 10 points: multi-TCG opportunity (2+ sites = full points)
       (case
          when cardinality(p.relevant_tcgs) >= 3 then 10
          when cardinality(p.relevant_tcgs) = 2  then 7
          when cardinality(p.relevant_tcgs) = 1  then 3
          else 0
        end) as cross_tcg_pts
  from public.network_partners p
  left join contact_quality cq on cq.partner_id = p.id;

comment on view public.v_crm_vendor_scoring is
  'CN-06A deterministic lead scoring. Admin pages sum the five *_pts columns to compute fit_score.';

-- 7. Seed the 16 vendor categories -------------------------------
--
-- Prices are GBP, in pence. Entry = minimum tier a vendor can start
-- at; premium = top end for high-fit multi-site deals. These are
-- initial benchmarks, not promises; the sales flow in admin lets
-- the operator override on a per-deal basis.

insert into public.crm_vendor_categories
  (code, display_name, description, target_customer, why_tcg_audience, default_relevant_tcgs, intro_price_minor, premium_price_minor, sort_order)
values
  ('grading_authentication',
   'Card Grading & Authentication',
   'Services that encapsulate and grade cards for condition and authenticity (PSA, BGS, CGC, SGC and the newer entrants).',
   'Collectors with high-value raw cards considering grading submission.',
   'Collector Network readers reach grading services at the exact moment they are valuing an individual printing. Grading CTA alongside live retail price is high-intent.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   30000, 150000, 10),

  ('online_tcg_retailer',
   'Online TCG Retailer',
   'Pure-play ecommerce retailers of singles and sealed TCG product.',
   'Collectors shopping specific printings, sets or sealed boxes.',
   'Readers already have purchase intent on card and set pages. Featured retailer slots convert because the audience is live-searching for the exact SKU.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   25000, 100000, 20),

  ('lgs_online_hybrid',
   'Local Card Shop (Online + Physical)',
   'US local card shops with meaningful online operations.',
   'Local collectors + national buyers reaching through the online storefront.',
   'Shops with regional specialities (vintage, graded, specific TCG focus) stand out versus generic marketplaces when matched to the right site.',
   ARRAY['pokemon','mtg','ygo'],
   15000, 60000, 30),

  ('sealed_distributor',
   'Sealed Product Retailer & Distributor',
   'Businesses buying and selling sealed boxes, cases and bricks.',
   'Breakers, resellers, LGS and the deep end of the collector market.',
   'Sealed-product traffic concentrates on set release pages and market-value content. Distributors benefit from pre-release and new-set surfaces.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   30000, 120000, 40),

  ('singles_specialist',
   'Singles & Vintage Specialist',
   'Dealers focused on vintage, high-value singles, chase-rarity trading.',
   'Collectors chasing specific grails or completing vintage sets.',
   'Collectors on individual card pages (especially vintage LOB, Base Set, early Chronicles) are literally researching the exact card the specialist stocks.',
   ARRAY['pokemon','mtg','ygo'],
   25000, 100000, 50),

  ('buylist',
   'Card Buylist / Buying Service',
   'Companies that buy cards and collections from the public.',
   'Collectors looking to sell singles or bulk, or liquidate collections.',
   'Our audience includes collectors who have reached the sell-side of their lifecycle. Buylist CTAs on card pages are directly actionable.',
   ARRAY['pokemon','mtg','ygo'],
   20000, 80000, 60),

  ('auction_consignment',
   'Auction House & Consignment',
   'Formal auction and high-end consignment services (Goldin, PWCC, Heritage, Robert Edward).',
   'Collectors with graded or high-value raw cards worth consigning rather than listing privately.',
   'Readers on $500+ chase-card pages (and particularly on graded views) are a natural consignment-funnel audience.',
   ARRAY['pokemon','mtg','ygo'],
   40000, 200000, 70),

  ('marketplace_platform',
   'Marketplace / Selling Platform',
   'Peer-to-peer selling platforms specific to collectibles (Alt, MyCardLot, Card Ladder).',
   'Collectors buying and selling at scale.',
   'Platform brand exposure benefits from being named alongside TCGplayer / eBay on comparison views and price pages.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   30000, 120000, 80),

  ('accessories',
   'Card Accessories, Sleeves, Binders, Storage',
   'Protective products: sleeves, deck boxes, binders, toploaders, Supplies, portfolio pages.',
   'Collectors building their first storage setup or upgrading to premium.',
   'Collection-management features on our sites surface accessories at the moment of inventory. Accessory brands fit alongside “track your collection” CTAs.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   20000, 80000, 90),

  ('display_premium',
   'Display Cases & Premium Protection',
   'Premium display, graded-slab holders, framing and specialty storage.',
   'Owners of graded/high-value cards who want visible display or vault-grade protection.',
   'Readers hitting graded market pages are the premium-protection audience. Natural pairing with graded CTA.',
   ARRAY['pokemon','mtg','ygo'],
   25000, 90000, 100),

  ('scanning_inventory',
   'Scanning / Inventory / Collection Software',
   'Apps and tools that scan cards and manage collections (CollX, Dex, Collectr, Mavin).',
   'Collectors starting or systematising their collection.',
   'Our collection features and card finders are a direct funnel to app installs. Fits as a tool directory alongside catalogue tools.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   15000, 70000, 110),

  ('card_show_event',
   'Card Shows, Conventions & Event Organisers',
   'Trade-show, convention and regional card-show operators.',
   'Collectors who travel for shows + local buyers in the region.',
   'Our audience is show-active. Promoted events + featured listings route live traffic to regional shows timed with set releases.',
   ARRAY['pokemon','mtg','ygo'],
   15000, 60000, 120),

  ('breaker_livestream',
   'Breakers, Streamers & Live-selling',
   'Live-streaming case breakers (Whatnot sellers, Fanatics Live), content-first commerce.',
   'Collectors buying slots in live breaks or watching for value picks.',
   'Fits as a dedicated vendor list adjacent to new-set release surfaces where live breaks concentrate.',
   ARRAY['pokemon','onepiece'],
   20000, 80000, 130),

  ('insurance',
   'Collectibles Insurance',
   'Specialist insurers (Collectibles Insurance Services, Hugh Wood, etc.).',
   'Collectors with portfolios >$5k who need coverage beyond home-contents policies.',
   'Our graded and most-valuable surfaces attract exactly this collector tier. Natural fit for sidebar brand placement.',
   ARRAY['pokemon','mtg','ygo'],
   20000, 80000, 140),

  ('subscription_mystery',
   'Subscription Boxes & Mystery Services',
   'Monthly card boxes, mystery packs, subscription grading drops.',
   'Collectors seeking recurring hobby stimulus.',
   'Fits insight-article sponsorships and category-landing surfaces.',
   ARRAY['pokemon','mtg','ygo'],
   15000, 70000, 150),

  ('other_collector_business',
   'Other Commercially Relevant Collector Businesses',
   'Catch-all for aligned businesses that don''t fit the above (TCG media, tournaments, deck-track tools, printing / proxy, insurance tech, etc.).',
   'Varies by subcategory.',
   'Reviewed case-by-case; placement crafted to the specific business.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'],
   15000, 100000, 999)
on conflict (code) do nothing;

-- 8. Seed representative sponsorship offers per category ---------
--
-- Entry tier matches the £300/mo working benchmark. Premium tier
-- reserves headroom for multi-site, year-long deals. is_live_capability
-- marks offers that can ship today vs those needing dev work.

insert into public.crm_vendor_offers
  (category_code, slug, display_name, description, placement_sites, price_minor, tier, is_live_capability, development_notes)
values
  ('grading_authentication', 'graded_cta_single_site',
   'Grading CTA on graded market pages (single site)',
   'Logo + "Grade with X" CTA on /market/graded and card graded sections of ONE Collector Network site.',
   ARRAY['pokemon'], 30000, 'entry', true, null),

  ('grading_authentication', 'graded_cta_network_wide',
   'Grading CTA on graded market pages (all five sites)',
   'Logo + CTA on graded market surfaces network-wide. Includes rotating editorial mention.',
   ARRAY['network'], 100000, 'premium', true, null),

  ('online_tcg_retailer', 'featured_retailer_set_pages',
   'Featured retailer on set catalogue pages',
   'Prominent "Shop this set at X" link on /set/[slug] for one Collector Network site. Rotating with sealed-distributor slot where applicable.',
   ARRAY['pokemon'], 30000, 'standard', false,
   'Requires /set/[slug] template update to add vendor-link slot. ~2 days work.'),

  ('online_tcg_retailer', 'homepage_brand_strip',
   'Homepage brand strip (single site)',
   'Logo in the homepage brand strip on one Collector Network site.',
   ARRAY['pokemon'], 25000, 'entry', false,
   'Requires homepage sponsor strip component. ~1 day work.'),

  ('lgs_online_hybrid', 'regional_lgs_listing',
   'Regional LGS featured listing',
   'LGS directory entry with photo + opening hours + featured positioning for 12 months.',
   ARRAY['network'], 15000, 'entry', false,
   'Requires LGS directory feature (new /lgs route). ~3 days work.'),

  ('sealed_distributor', 'sealed_sidebar_release',
   'New-set sealed-product sidebar',
   'Sealed-product sidebar on new-set release pages across chosen sites.',
   ARRAY['pokemon','onepiece'], 30000, 'standard', false,
   'Requires sealed-sidebar component on /set/[slug]. ~2 days work.'),

  ('singles_specialist', 'vintage_specialist_cta',
   'Vintage specialist CTA on vintage card pages',
   'Dealer-specific CTA alongside live retail quote on vintage card pages (e.g. Base Set Charizard).',
   ARRAY['pokemon'], 25000, 'standard', false,
   'Requires vintage-dealer-pointer field on card page. ~1 day work.'),

  ('buylist', 'card_page_buylist_cta',
   'Buylist CTA on card pages',
   '"Sell your copy to X" CTA alongside buy-price panel.',
   ARRAY['pokemon','mtg','ygo'], 20000, 'entry', false,
   'Requires buylist CTA slot in card-page template. ~1 day work.'),

  ('auction_consignment', 'graded_consignment_cta',
   'Consignment CTA on graded market pages',
   '"Consign your graded copy to X" alongside PSA 10 value sections.',
   ARRAY['pokemon','mtg','ygo'], 40000, 'premium', true, null),

  ('marketplace_platform', 'marketplace_logo_pricing',
   'Marketplace logo on comparison pricing panels',
   'Platform logo alongside TCGplayer/eBay comparison on card pages.',
   ARRAY['pokemon','mtg','ygo','onepiece','lorcana'], 30000, 'standard', false,
   'Requires expanded pricing comparison panel. ~2 days work.'),

  ('accessories', 'collection_feature_sponsor',
   'Collection-management feature sponsor',
   'Brand sponsorship of collection tracker + watchlist surfaces across chosen sites.',
   ARRAY['network'], 20000, 'entry', true, null),

  ('display_premium', 'graded_sidebar_display',
   'Display-case sidebar on graded market pages',
   'Logo + product-category exposure on graded pages.',
   ARRAY['pokemon','mtg','ygo'], 25000, 'standard', false,
   'Requires graded sidebar slot. ~1 day work.'),

  ('scanning_inventory', 'tool_directory_feature',
   'Featured app in collection-tool directory',
   'App directory tile with link to app-store page + website.',
   ARRAY['network'], 15000, 'entry', false,
   'Requires new /tools or /apps directory route. ~2 days work.'),

  ('card_show_event', 'featured_event_listing',
   'Featured event listing with homepage mention',
   'Event detail page + homepage "Upcoming shows" mention 30 days ahead.',
   ARRAY['pokemon','mtg','ygo'], 15000, 'entry', false,
   'Requires /events feature (new route + CMS integration). ~3 days work.'),

  ('breaker_livestream', 'release_breaker_sidebar',
   'Breaker sidebar on new-set release surfaces',
   'Breaker brand placement + stream-link on new-set release pages.',
   ARRAY['pokemon','onepiece'], 20000, 'entry', false,
   'Requires breaker-slot component. ~1 day work.'),

  ('insurance', 'sidebar_insurance_mention',
   'Insurance sidebar on high-value card pages',
   'Insurance brand sidebar on card pages above a value threshold.',
   ARRAY['pokemon','mtg','ygo'], 20000, 'entry', false,
   'Requires threshold-gated sidebar slot. ~1 day work.'),

  ('subscription_mystery', 'insight_article_sponsor',
   'Sponsored insight article',
   'Dedicated sponsored editorial piece + 30-day sidebar follow-up.',
   ARRAY['pokemon','mtg','ygo'], 15000, 'entry', true, null)
on conflict (category_code, slug) do nothing;

-- 9. Seed outreach templates (operator reviews + sends manually) --
--
-- Templates use {{placeholders}} that the admin UI fills in from
-- partner + contact + offer context. No autonomous sending.

insert into public.crm_outreach_templates
  (category_code, slug, subject_line, body_markdown, variables, notes)
values
  ('grading_authentication', 'intro_grading_cta',
   'Partnering with Collector Network on grading referrals',
   E'Hi {{contact_first_name}},\n\nI run Collector Network, a group of five TCG pricing sites covering Pokémon, Magic, Yu-Gi-Oh!, One Piece and Lorcana. Our graded-market pages see a focused collector audience actively valuing high-grade cards.\n\nI''d like to explore a grading-CTA sponsorship for {{company_name}}: a brand-and-link placement on our graded market views and vintage card pages where submission intent is highest.\n\nStarting price is {{offer_price}} per month on a 12-month agreement, with scope for a network-wide premium package if that suits.\n\nHappy to send a one-page overview or jump on a 20-minute call.\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_price'],
   'For PSA, BGS, CGC, SGC and newer entrants. Lead with graded-page intent.'),

  ('online_tcg_retailer', 'intro_retailer_card_pages',
   'Featured retailer slot on {{site_name}}',
   E'Hi {{contact_first_name}},\n\nCollector Network runs five TCG pricing sites, and our card and set pages reach collectors with active purchase intent — they''re looking up the exact printing before buying.\n\n{{company_name}} is a natural fit for a featured-retailer slot on {{site_name}}. The entry package is {{offer_price}} per month and places your brand on set catalogue pages where visitors are already shopping for your SKUs.\n\nI can share a short slide with placement examples and realistic traffic figures (dated and honest — we don''t forecast conversions we can''t substantiate).\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','site_name','offer_price'],
   'For TCGplayer-adjacent retailers, Troll and Toad, Card Kingdom, Star City Games etc.'),

  ('accessories', 'intro_accessories_collection_feature',
   'Collection-tracker sponsor at Collector Network',
   E'Hi {{contact_first_name}},\n\nThe collection-tracking and watchlist features across Collector Network''s five TCG sites surface accessory brands at the exact moment a collector is inventorying what they own. {{company_name}} would be a natural brand sponsor for that surface.\n\nStarting at {{offer_price}}/month, you''d get brand placement across the network collection views and a dedicated mention in collector-guide editorial.\n\nShall I send a one-page outline?\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_price'],
   'For Ultra PRO, Dragon Shield, BCW, Max Protection.'),

  ('auction_consignment', 'intro_consignment_graded',
   'Consignment referrals from Collector Network graded pages',
   E'Hi {{contact_first_name}},\n\nMy five Collector Network sites index pricing across Pokémon, Magic, Yu-Gi-Oh!, One Piece and Lorcana — including graded market views where visitors are literally researching PSA 10 values.\n\nThat audience is a natural source of consignment leads for {{company_name}}. I''d like to discuss a graded-page sponsorship that places your brand alongside PSA 10 pricing on cards above a value threshold.\n\nThe premium package is {{offer_price}}/month on a 12-month agreement. Open to tailoring; the goal is useful referral quality, not volume for its own sake.\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_price'],
   'For Goldin, PWCC, Heritage, Robert Edward Auctions.'),

  ('buylist', 'intro_buylist_card_cta',
   'Buylist CTA on Collector Network card pages',
   E'Hi {{contact_first_name}},\n\nCollectors reach our card pages mid-decision. Some are buying; a meaningful portion are considering selling — and that''s your audience.\n\nI''d like to add a {{company_name}} buylist CTA on card pages across Collector Network, starting at {{offer_price}}/month. Explicit "Sell your copy" wording, properly identified as sponsored.\n\nHappy to put a short overview together.\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_price'],
   'For CardCash and similar.'),

  ('marketplace_platform', 'intro_marketplace_comparison',
   'Marketplace placement on Collector Network pricing panels',
   E'Hi {{contact_first_name}},\n\nCollector Network card pages already compare TCGplayer and eBay pricing. Adding {{company_name}} to that comparison places you in front of collectors at the exact moment they''re deciding where to buy or list.\n\nStarting at {{offer_price}}/month, we''d expand the comparison panel to include your platform, cross all five Collector Network sites, with proper sponsored-link attribution.\n\nShall I send through placement mockups?\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_price'],
   'For Alt, MyCardLot, Card Ladder.'),

  ('sealed_distributor', 'intro_sealed_new_set',
   'New-set sealed-product sidebar on {{site_name}}',
   E'Hi {{contact_first_name}},\n\nWhen a new TCG set drops, our release pages spike with collectors looking at sealed-product pricing. {{company_name}} is a natural brand for a new-set sidebar slot.\n\n{{offer_price}}/month for sealed-product placement on {{site_name}} release surfaces across a 12-month term. We can tune the sites you want to appear on.\n\nHappy to share a one-page overview.\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','site_name','offer_price'],
   'For Blowout Cards, Dave & Adam, Steel City Collectibles, Potomac Distribution.'),

  ('card_show_event', 'intro_event_featured',
   'Featured event listing at Collector Network',
   E'Hi {{contact_first_name}},\n\nCollector Network readers are show-active and travel for the right event. I''d like to feature {{company_name}}''s {{event_name}} on our upcoming-shows surface.\n\n{{offer_price}} for a featured listing plus a 30-day homepage mention in the run-up. Properly identified as sponsored.\n\nShall I send through the brief?\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','event_name','offer_price'],
   'For National Sports Collectors Convention and regional shows. Needs event_name variable.'),

  (null, 'generic_followup_1',
   'Following up — {{company_name}} + Collector Network',
   E'Hi {{contact_first_name}},\n\nJust bumping my earlier note on a Collector Network sponsorship for {{company_name}}. Short reminder: {{offer_summary}}.\n\nIs there a better time or person on your side to connect with?\n\nBest,\nLuke Pierce\nCollector Network',
   ARRAY['contact_first_name','company_name','offer_summary'],
   'Generic follow-up for any first-reply gap after 7-10 days.')
on conflict (slug) do nothing;

-- 10. Trigger: keep updated_at honest ---------------------------

create or replace function public.cn06a_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_vendor_categories_touch') then
    create trigger crm_vendor_categories_touch before update on public.crm_vendor_categories
      for each row execute function public.cn06a_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_vendor_offers_touch') then
    create trigger crm_vendor_offers_touch before update on public.crm_vendor_offers
      for each row execute function public.cn06a_touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'crm_outreach_templates_touch') then
    create trigger crm_outreach_templates_touch before update on public.crm_outreach_templates
      for each row execute function public.cn06a_touch_updated_at();
  end if;
end $$;
