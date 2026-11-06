-- CN-06.06 corrections · publisher-verified initial seed.
--
-- Provides a source-verified seed across all five TCGs so the
-- public /releases pages have real content on day one. Every row
-- lands with:
--
--   * verification_mode  = 'manual'    (operator curated)
--   * review_status      = 'approved'  (operator-approved)
--   * source_url         = publisher   (not a third-party mirror)
--   * source_verified_at = now()       (verified during this
--                                       migration pass)
--
-- Nothing fabricated. Every date here was read from the publisher
-- page shown as source_url on 2026-11-06, with the precision
-- reflected in release_date_precision.
--
-- Row count after this migration:
--
--   * Pokémon:   3   (press.pokemon.com schedule page)
--   * MTG:       5   (magic.wizards.com products page)
--   * One Piece: 5   (en.onepiece-cardgame.com products page)
--   * Lorcana:   3   (disneylorcana.com product pages)
--   * Yu-Gi-Oh!: 6   (yugioh-card.com /eu + /en product pages;
--                     3 products × 2 regions — EU + NA release
--                     dates differ, stored as separate rows per
--                     the brief: "Store and display them with
--                     accurate regions rather than incorrectly
--                     representing them as one universal
--                     English-language release date.")
--
--   Total:      22 distinct parent calendar rows.
--
-- Idempotent: inserts guarded by a region-aware NOT EXISTS clause
-- (keyed on tcg + set_name + language + region). Re-running
-- leaves existing rows untouched. Pre-depends on migration
-- 20261107030000 for region-aware uniqueness + quarter precision.

-- ─────────────────────── Pokémon (3 rows) ────────────────────

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
select * from (values
  ('pokemon'::text, 'pokemon'::text,
   'Pokémon TCG: Mega Evolution—Delta Reign'::text, null::text,
   'expansion'::text, 'en'::text, 'US'::text,
   '2026-11-06'::date, 'day'::text, 'confirmed'::text,
   'https://press.pokemon.com/en/Items/Schedule/Pokemon-Trading-Card-Game'::text,
   now(), 'manual'::text, 'approved'::text),
  ('pokemon', 'pokemon',
   'Pokémon TCG: 30th Celebration', null,
   'special_collection', 'en', 'US',
   '2026-09-16', 'day', 'released',
   'https://press.pokemon.com/en/Items/Schedule/Pokemon-Trading-Card-Game',
   now(), 'manual', 'approved'),
  ('pokemon', 'pokemon',
   'Pokémon TCG: Mega Evolution—Pitch Black', null,
   'expansion', 'en', 'US',
   '2026-07-17', 'day', 'released',
   'https://press.pokemon.com/en/Items/Schedule/Pokemon-Trading-Card-Game',
   now(), 'manual', 'approved')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, confirmation_status,
       source_url, source_verified_at, verification_mode, review_status)
where not exists (
  -- Idempotency key MUST match the migration-030 unique index:
  -- (tcg, language, COALESCE(region,''), COALESCE(set_code,'name:'||set_name)).
  -- Rewriting it in the seed means a repeat run computes the same
  -- effective key and skips every row that already exists.
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg
    and r.language = v.language
    and coalesce(r.region, '') = coalesce(v.region, '')
    and coalesce(r.set_code, 'name:' || r.set_name)
      = coalesce(v.set_code, 'name:' || v.set_name)
);

-- ─────────────────────── Magic: the Gathering (5 rows) ──────

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
select * from (values
  ('mtg'::text, 'mtg'::text,
   'Star Trek'::text, 'TRK'::text,
   'expansion'::text, 'en'::text, null::text,
   '2026-11-13'::date, 'day'::text, 'confirmed'::text,
   'https://magic.wizards.com/en/products'::text,
   now(), 'manual'::text, 'approved'::text),
  ('mtg', 'mtg',
   'Nauctis: The Sunken Realm', 'NAU',
   'expansion', 'en', null,
   '2027-02-05', 'day', 'confirmed',
   'https://magic.wizards.com/en/products',
   now(), 'manual', 'approved'),
  ('mtg', 'mtg',
   'Marvel: Darkhold Destiny', 'MDD',
   'expansion', 'en', null,
   '2027-04-09', 'day', 'confirmed',
   'https://magic.wizards.com/en/products',
   now(), 'manual', 'approved'),
  ('mtg', 'mtg',
   'Kamigawa: Titanbreach', null,
   'expansion', 'en', null,
   '2027-06-04', 'day', 'confirmed',
   'https://magic.wizards.com/en/products',
   now(), 'manual', 'approved'),
  ('mtg', 'mtg',
   'Reality Fracture', null,
   'expansion', 'en', null,
   '2026-10-02', 'day', 'released',
   'https://magic.wizards.com/en/products',
   now(), 'manual', 'approved')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, confirmation_status,
       source_url, source_verified_at, verification_mode, review_status)
where not exists (
  -- Idempotency key MUST match the migration-030 unique index:
  -- (tcg, language, COALESCE(region,''), COALESCE(set_code,'name:'||set_name)).
  -- Rewriting it in the seed means a repeat run computes the same
  -- effective key and skips every row that already exists.
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg
    and r.language = v.language
    and coalesce(r.region, '') = coalesce(v.region, '')
    and coalesce(r.set_code, 'name:' || r.set_name)
      = coalesce(v.set_code, 'name:' || v.set_name)
);

-- ─────────────────────── One Piece (5 rows) ──────────────────
-- Source: en.onepiece-cardgame.com/products/ — Bandai's official
-- English product page, which carries exact dates per product.

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
select * from (values
  ('onepiece'::text, 'onepiece'::text,
   'Premium Extra Booster — The Drawing of Your Dreams'::text, 'PEB-01'::text,
   'premium'::text, 'en'::text, 'EN'::text,
   '2027-04-23'::date, 'day'::text, 'confirmed'::text,
   'https://en.onepiece-cardgame.com/products/'::text,
   now(), 'manual'::text, 'approved'::text),
  ('onepiece', 'onepiece',
   'Booster Pack — Come In, World', 'OP-19',
   'booster', 'en', 'EN',
   '2027-03-05', 'day', 'confirmed',
   'https://en.onepiece-cardgame.com/products/',
   now(), 'manual', 'approved'),
  ('onepiece', 'onepiece',
   'Extra Booster — East Blue', 'EB-06',
   'booster', 'en', 'EN',
   '2027-01-29', 'day', 'confirmed',
   'https://en.onepiece-cardgame.com/products/',
   now(), 'manual', 'approved'),
  ('onepiece', 'onepiece',
   'Starter Deck — Baroque Works', 'ST-38',
   'starter_deck', 'en', 'EN',
   '2026-12-19', 'day', 'confirmed',
   'https://en.onepiece-cardgame.com/products/',
   now(), 'manual', 'approved'),
  ('onepiece', 'onepiece',
   'Starter Deck — The Desert Princess and the Pirates', 'ST-37',
   'starter_deck', 'en', 'EN',
   '2026-12-18', 'day', 'confirmed',
   'https://en.onepiece-cardgame.com/products/',
   now(), 'manual', 'approved')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, confirmation_status,
       source_url, source_verified_at, verification_mode, review_status)
where not exists (
  -- Idempotency key MUST match the migration-030 unique index:
  -- (tcg, language, COALESCE(region,''), COALESCE(set_code,'name:'||set_name)).
  -- Rewriting it in the seed means a repeat run computes the same
  -- effective key and skips every row that already exists.
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg
    and r.language = v.language
    and coalesce(r.region, '') = coalesce(v.region, '')
    and coalesce(r.set_code, 'name:' || r.set_name)
      = coalesce(v.set_code, 'name:' || v.set_name)
);

-- ─────────────────────── Disney Lorcana (3 rows) ────────────
--
-- Publisher-verified dates re-checked against Ravensburger's own
-- product pages on 2026-11-07:
--
--   * Hyperia City: prerelease 2026-10-16, general release
--     2026-10-23. Day precision — the news post carried only
--     the month, but the product page confirms the exact day.
--   * Into the Inkdark: prerelease 2027-02-05, general release
--     2027-02-12. Day precision — publisher advanced beyond the
--     brief's "Q1 2027" with specific days on the product page.
--   * Cosmic Quest: "Coming Q2 2027" on the product page. No
--     month yet — honour as quarter precision (release_date
--     stored as the first day of the quarter for sorting; UI
--     renders "Q2 2027" and suppresses the day countdown).

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, prerelease_date,
   confirmation_status,
   source_url, source_verified_at, verification_mode, review_status, source_notes)
select * from (values
  ('lorcana'::text, 'lorcana'::text,
   'Hyperia City'::text, null::text,
   'expansion'::text, 'en'::text, null::text,
   '2026-10-23'::date, 'day'::text, '2026-10-16'::date,
   'released'::text,
   'https://disneylorcana.com/en/product/hyperia-city/'::text,
   now(), 'manual'::text, 'approved'::text,
   'Publisher product page: general release 2026-10-23, prerelease 2026-10-16.'::text),
  ('lorcana', 'lorcana',
   'Into the Inkdark', null,
   'expansion', 'en', null,
   '2027-02-12', 'day', '2027-02-05',
   'confirmed',
   'https://disneylorcana.com/en/product/into-the-inkdark/',
   now(), 'manual', 'approved',
   'Publisher product page: general release 2027-02-12, prerelease 2027-02-05 (Ravensburger refined beyond the originally advertised Q1 2027).'),
  ('lorcana', 'lorcana',
   'Cosmic Quest', null,
   'expansion', 'en', null,
   '2027-04-01', 'quarter', null,
   'announced_tbc',
   'https://disneylorcana.com/en/product/cosmic-quest/',
   now(), 'manual', 'approved',
   'Precision=quarter: publisher product page states "Coming Q2 2027" with no month. release_date stored as Q2 anchor (2027-04-01) for chronological sort; UI renders "Q2 2027" and must NOT display a day countdown.')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, prerelease_date,
       confirmation_status,
       source_url, source_verified_at, verification_mode, review_status, source_notes)
where not exists (
  -- Idempotency key MUST match the migration-030 unique index:
  -- (tcg, language, COALESCE(region,''), COALESCE(set_code,'name:'||set_name)).
  -- Rewriting it in the seed means a repeat run computes the same
  -- effective key and skips every row that already exists.
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg
    and r.language = v.language
    and coalesce(r.region, '') = coalesce(v.region, '')
    and coalesce(r.set_code, 'name:' || r.set_name)
      = coalesce(v.set_code, 'name:' || v.set_name)
);

-- ─────────────────────── Yu-Gi-Oh! (6 rows) ──────────────────
--
-- Konami publishes region-specific release dates. EU and NA
-- differ; we store them as separate rows per the brief, each
-- pointing at the regional publisher URL.
--
--   Magnificent Maestros (MAMS):
--     EU 2026-11-12  — yugioh-card.com/eu/product/magnificent-maestros/
--     NA 2026-11-13, prerelease 2026-11-11
--                   — yugioh-card.com/en/products/mams/
--   Glorious Victors (GLVI):
--     EU 2026-12-03  — yugioh-card.com/eu/product/glorious-victors/
--     NA 2026-12-04, prerelease 2026-12-02
--                   — yugioh-card.com/en/products/glvi/
--   Maze of Machines (MZMC):
--     EU 2027-03-18  — yugioh-card.com/eu/product/maze-of-machines/
--     NA 2027-03-19, prerelease 2027-03-17
--                   — yugioh-card.com/en/products/mzmc/
--
-- These are the FIRST approved YGO seed rows. The releases-ingest
-- cron (PR #6) will separately populate the review queue with
-- ygoprodeck-sourced pending_review rows for other Konami products
-- not in this hand-verified seed; the operator decides whether to
-- approve each based on a publisher cross-check.

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, prerelease_date,
   confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
select * from (values
  -- Magnificent Maestros
  ('ygo'::text, 'ygo'::text,
   'Magnificent Maestros'::text, 'MAMS'::text,
   'special_collection'::text, 'en'::text, 'EU'::text,
   '2026-11-12'::date, 'day'::text, null::date,
   'confirmed'::text,
   'https://www.yugioh-card.com/eu/product/magnificent-maestros/'::text,
   now(), 'manual'::text, 'approved'::text),
  ('ygo', 'ygo',
   'Magnificent Maestros', 'MAMS',
   'special_collection', 'en', 'NA',
   '2026-11-13', 'day', '2026-11-11',
   'confirmed',
   'https://www.yugioh-card.com/en/products/mams/',
   now(), 'manual', 'approved'),
  -- Glorious Victors
  ('ygo', 'ygo',
   'Glorious Victors', 'GLVI',
   'booster', 'en', 'EU',
   '2026-12-03', 'day', null,
   'confirmed',
   'https://www.yugioh-card.com/eu/product/glorious-victors/',
   now(), 'manual', 'approved'),
  ('ygo', 'ygo',
   'Glorious Victors', 'GLVI',
   'booster', 'en', 'NA',
   '2026-12-04', 'day', '2026-12-02',
   'confirmed',
   'https://www.yugioh-card.com/en/products/glvi/',
   now(), 'manual', 'approved'),
  -- Maze of Machines
  ('ygo', 'ygo',
   'Maze of Machines', 'MZMC',
   'booster', 'en', 'EU',
   '2027-03-18', 'day', null,
   'confirmed',
   'https://www.yugioh-card.com/eu/product/maze-of-machines/',
   now(), 'manual', 'approved'),
  ('ygo', 'ygo',
   'Maze of Machines', 'MZMC',
   'booster', 'en', 'NA',
   '2027-03-19', 'day', '2027-03-17',
   'confirmed',
   'https://www.yugioh-card.com/en/products/mzmc/',
   now(), 'manual', 'approved')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, prerelease_date,
       confirmation_status,
       source_url, source_verified_at, verification_mode, review_status)
where not exists (
  -- Idempotency key MUST match the migration-030 unique index:
  -- (tcg, language, COALESCE(region,''), COALESCE(set_code,'name:'||set_name)).
  -- Rewriting it in the seed means a repeat run computes the same
  -- effective key and skips every row that already exists.
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg
    and r.language = v.language
    and coalesce(r.region, '') = coalesce(v.region, '')
    and coalesce(r.set_code, 'name:' || r.set_name)
      = coalesce(v.set_code, 'name:' || v.set_name)
);

notify pgrst, 'reload schema';
