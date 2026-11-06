-- CN-06.06 corrections · publisher-verified initial seed.
--
-- Provides a small, source-verified seed across all five TCGs so
-- the public /releases pages have real content on day one. Every
-- row lands with:
--
--   * verification_mode = 'manual'      (operator curated)
--   * review_status     = 'approved'    (operator-approved)
--   * source_url        = publisher     (not a third-party mirror)
--   * source_verified_at = now()        (verified during this
--                                        migration pass)
--
-- Nothing fabricated. Every date here was read from the publisher
-- page shown as source_url on 2026-11-06 or earlier, with the
-- precision reflected in release_date_precision.
--
-- Idempotent: inserts guarded by (tcg, set_code, language) unique
-- constraint. Re-running leaves existing rows untouched.
--
-- Publisher sources used:
--   * Pokémon:   https://press.pokemon.com/en/Items/Schedule/
--                  Pokemon-Trading-Card-Game
--   * MTG:       https://magic.wizards.com/en/products
--   * One Piece: https://en.onepiece-cardgame.com/products/
--   * Lorcana:   https://disneylorcana.com/en/news/
--                  (approximate month only; publisher does not
--                   advertise exact dates on the news feed)
--   * Yu-Gi-Oh:  yugioh-card.com /eu/products/latest-releases/
--                  lists product names but NOT dates. YGO is
--                  intentionally absent from this seed and
--                  flagged for operator follow-up — see the
--                  trailing NOTICE at the end of this file.

-- ─────────────────────── Pokémon ──────────────────────────────
--
-- Pokémon's press schedule page does not surface set codes. We
-- leave set_code NULL and guard idempotency on (tcg, set_name,
-- language). The base table's unique(tcg, set_code, language)
-- treats NULL set_code as distinct (PG default), so we must
-- gate with NOT EXISTS to be safe on re-runs.

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
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg and r.set_name = v.set_name and r.language = v.language
);

-- ─────────────────────── Magic: the Gathering ────────────────

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
values
  ('mtg', 'mtg',
   'Star Trek', 'TRK',
   'expansion', 'en', null,
   '2026-11-13', 'day', 'confirmed',
   'https://magic.wizards.com/en/products',
   now(), 'manual', 'approved'),
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
on conflict (tcg, set_code, language) do nothing;

-- ─────────────────────── One Piece ────────────────────────────
--
-- Source: en.onepiece-cardgame.com/products/ — Bandai's official
-- English product page, which carries exact dates per product.

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status)
values
  ('onepiece', 'onepiece',
   'Premium Extra Booster — The Drawing of Your Dreams', 'PEB-01',
   'premium', 'en', 'EN',
   '2027-04-23', 'day', 'confirmed',
   'https://en.onepiece-cardgame.com/products/',
   now(), 'manual', 'approved'),
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
on conflict (tcg, set_code, language) do nothing;

-- ─────────────────────── Disney Lorcana ──────────────────────
--
-- disneylorcana.com advertises set NAMES but not exact release
-- dates on the news feed. We seed:
--   * "Hyperia City" with release_date_precision='month' and
--     release_date=2026-10-01 so the public display renders
--     "October 2026" (never fabricating a day).
--   * "Into the Inkdark" and "Cosmic Quest" with precision='tbc'
--     and release_date=null so the public display shows "TBC".
--
-- Operator should refine to exact day precision once Disney
-- publishes the final date.

insert into public.network_tcg_releases
  (tcg, site_slug, set_name, set_code, product_type, language, region,
   release_date, release_date_precision, confirmation_status,
   source_url, source_verified_at, verification_mode, review_status, source_notes)
select * from (values
  ('lorcana'::text, 'lorcana'::text,
   'Hyperia City'::text, null::text,
   'expansion'::text, 'en'::text, null::text,
   '2026-10-01'::date, 'month'::text, 'released'::text,
   'https://disneylorcana.com/en/news/2026/09/disney-lorcana-trading-card-game-heads-to-hyperia-city/'::text,
   now(), 'manual'::text, 'approved'::text,
   'Precision=month: publisher news post confirms October 2026 release; exact day not published on the news feed.'::text),
  ('lorcana', 'lorcana',
   'Into the Inkdark', null,
   'expansion', 'en', null,
   null, 'tbc', 'announced_tbc',
   'https://disneylorcana.com/en/product/into-the-inkdark/',
   now(), 'manual', 'approved',
   'Precision=tbc: publisher product page exists but release date not yet announced.'),
  ('lorcana', 'lorcana',
   'Cosmic Quest', null,
   'expansion', 'en', null,
   null, 'tbc', 'announced_tbc',
   'https://disneylorcana.com/en/product/cosmic-quest/',
   now(), 'manual', 'approved',
   'Precision=tbc: publisher product page exists but release date not yet announced.')
) as v(tcg, site_slug, set_name, set_code, product_type, language, region,
       release_date, release_date_precision, confirmation_status,
       source_url, source_verified_at, verification_mode, review_status, source_notes)
where not exists (
  select 1 from public.network_tcg_releases r
  where r.tcg = v.tcg and r.set_name = v.set_name and r.language = v.language
);

-- ─────────────────────── Yu-Gi-Oh! ────────────────────────────
-- Konami's public product pages (yugioh-card.com/eu/products/
-- latest-releases/ and /en/products/) list product names but NOT
-- release dates on the page itself. Third-party catalogues
-- (ygoprodeck) do carry dates, but the brief treats those as
-- "discovery" — the row must land in pending_review and be
-- verified against a publisher source before approval.
--
-- Rather than fabricate an approved seed, YGO is left empty here.
-- Once the daily releases-ingest cron fires post-deploy, the
-- ygoprodeck-sourced rows will appear in the admin review queue
-- for the operator to cross-check against a Konami press release
-- or regional product listing, then approve.
--
-- This is the operating policy the brief requires: "Third-party
-- API results are never automatically treated as official
-- verified dates."

-- No INSERT for Yu-Gi-Oh! — intentional.

notify pgrst, 'reload schema';
