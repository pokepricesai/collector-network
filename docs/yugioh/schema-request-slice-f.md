# Slice F schema request — `ygo_decks` + `ygo_deck_cards`

Status: **paste into the Supabase SQL editor for the shared
Collector Network project (preflightluke)**.

Slice F ships a deterministic Yu-Gi-Oh deck builder on top of the
existing shared auth identity. Gameplay identity is kept strictly
separate from collectible-printing identity.

## Gameplay identity (important — read this)

The live YGO catalogue currently has **no stable per-card gameplay
identifier**. A single Yu-Gi-Oh card (e.g. *Blue-Eyes White
Dragon*) is represented by 69 distinct `tcg_cards` rows — one per
reprint — and:

- `tcg_cards.english_id` is `NULL` on every row.
- `tcg_cards.tcggraph_card_id` is per-printing (one distinct value
  per reprint, not one per card).
- `tcg_cards.gamedata->>password` / `passcode` / `konami_id` are
  all absent.
- The only attribute all reprints share is `name`.

Given that reality, Slice F stores the gameplay identity as a
normalised, case-folded, whitespace-collapsed copy of the English
`name` (`card_key`). This is the **only** value the legality
engine, quantity aggregator and search join on.

The schema is deliberately designed so that when the catalogue
gains a real per-card canonical id (a Konami passcode, an
`english_id`, or a new logical-cards table) the migration to that
stronger identifier is a single ALTER TABLE + backfill — nothing
about the RLS surface, foreign-key surface or app-layer valuation
depends on `card_key` being a name.

`ygo_deck_cards` does **not** reference `tcg_cards`. `tcg_cards`
rows are per-printing and would over-constrain the deck. Instead
we optionally reference `tcg_printings` via
`preferred_tcg_printing_id` — a display + valuation hint that
does not affect gameplay, quantity or legality.

## Table shapes

### `ygo_decks`

- `id uuid primary key`
- `user_id uuid` → `auth.users(id)` **CASCADE**
- `name text`
- `description text`
- `format text` — `'tcg'` for now; enum-checked so we can extend later.
- `created_at`, `updated_at` timestamps.

### `ygo_deck_cards`

- `id uuid primary key`
- `deck_id uuid` → `ygo_decks(id)` **CASCADE** (per spec §20 — deleting a deck cleans up its cards)
- `card_key text` — the gameplay identity described above (NOT NULL).
- `card_name text` — cached display name at insert time.
- `preferred_tcg_printing_id text` → `tcg_printings(id)` **SET NULL** (spec §14: preferred printing must never affect gameplay; a printing being churned from the catalogue must not delete the user's deck entry).
- `section text` ∈ (`main`, `extra`, `side`).
- `quantity int` between 1 and 3 (physical maximum per section; F&L caps evaluated in the app across sections).
- `unique(deck_id, section, card_key)` — one row per (deck, section, card).
- `created_at`, `updated_at` timestamps.

## RLS

Owner-only for both tables (`auth.uid() = user_id` on `ygo_decks`,
subquery on `ygo_deck_cards`). All four verbs.

## Migration

Idempotent. Wrap in one transaction. Safe to re-run.

```sql
begin;

create table if not exists ygo_decks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (length(name) between 1 and 120),
  description  text check (description is null or length(description) <= 1000),
  format       text not null default 'tcg' check (format in ('tcg')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ygo_decks_user_id_idx
  on ygo_decks (user_id, updated_at desc);

alter table ygo_decks enable row level security;

drop policy if exists "owner reads own decks"   on ygo_decks;
drop policy if exists "owner inserts own decks" on ygo_decks;
drop policy if exists "owner updates own decks" on ygo_decks;
drop policy if exists "owner deletes own decks" on ygo_decks;

create policy "owner reads own decks"
  on ygo_decks for select using (auth.uid() = user_id);
create policy "owner inserts own decks"
  on ygo_decks for insert with check (auth.uid() = user_id);
create policy "owner updates own decks"
  on ygo_decks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner deletes own decks"
  on ygo_decks for delete using (auth.uid() = user_id);

drop trigger if exists ygo_decks_touch_updated_at on ygo_decks;
create trigger ygo_decks_touch_updated_at
  before update on ygo_decks
  for each row execute function ygo_touch_updated_at();

create table if not exists ygo_deck_cards (
  id                        uuid primary key default gen_random_uuid(),
  deck_id                   uuid not null references ygo_decks(id) on delete cascade,
  -- Gameplay identity. Today: normalised English name. Designed to
  -- be swappable for a proper canonical id later without changing
  -- FK/RLS surface or app-layer contracts.
  card_key                  text not null check (length(card_key) between 1 and 200),
  -- Cached display name at insert time — survives upstream name
  -- normalisation churn.
  card_name                 text not null check (length(card_name) between 1 and 200),
  -- Optional preferred exact printing. Affects display + value
  -- only; NEVER affects gameplay, quantity or legality. If the
  -- printing is removed from the catalogue we clear the preference
  -- rather than delete the deck entry.
  preferred_tcg_printing_id text references tcg_printings(id) on delete set null,
  section                   text not null check (section in ('main','extra','side')),
  quantity                  int  not null check (quantity between 1 and 3),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- One row per (deck, section, card family). Aggregating quantities
-- into a single row per section keeps the summary counters and
-- copy-limit checks unambiguous.
alter table ygo_deck_cards
  drop constraint if exists ygo_deck_cards_deck_section_card_unique;
alter table ygo_deck_cards add constraint ygo_deck_cards_deck_section_card_unique
  unique (deck_id, section, card_key);

create index if not exists ygo_deck_cards_deck_id_idx
  on ygo_deck_cards (deck_id, section);

alter table ygo_deck_cards enable row level security;

drop policy if exists "owner reads own deck cards"   on ygo_deck_cards;
drop policy if exists "owner inserts own deck cards" on ygo_deck_cards;
drop policy if exists "owner updates own deck cards" on ygo_deck_cards;
drop policy if exists "owner deletes own deck cards" on ygo_deck_cards;

-- Owner-only. Membership is derived from the parent deck row.
create policy "owner reads own deck cards"
  on ygo_deck_cards for select
  using (exists (
    select 1 from ygo_decks d
    where d.id = ygo_deck_cards.deck_id and d.user_id = auth.uid()
  ));

create policy "owner inserts own deck cards"
  on ygo_deck_cards for insert
  with check (exists (
    select 1 from ygo_decks d
    where d.id = ygo_deck_cards.deck_id and d.user_id = auth.uid()
  ));

create policy "owner updates own deck cards"
  on ygo_deck_cards for update
  using (exists (
    select 1 from ygo_decks d
    where d.id = ygo_deck_cards.deck_id and d.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from ygo_decks d
    where d.id = ygo_deck_cards.deck_id and d.user_id = auth.uid()
  ));

create policy "owner deletes own deck cards"
  on ygo_deck_cards for delete
  using (exists (
    select 1 from ygo_decks d
    where d.id = ygo_deck_cards.deck_id and d.user_id = auth.uid()
  ));

drop trigger if exists ygo_deck_cards_touch_updated_at on ygo_deck_cards;
create trigger ygo_deck_cards_touch_updated_at
  before update on ygo_deck_cards
  for each row execute function ygo_touch_updated_at();

commit;
```

## Consumer

`apps/yugioh/src/server/decks.ts` (created after this migration
lands). Uses the caller's session; RLS enforces owner-only access.
No service-role code path.

## Cascade / retention model

- Full account deletion via `auth.users` → cascades → all decks
  and deck cards go with it.
- Per-slice deletion via the settings DangerZone → the app runs
  explicit `delete from ygo_decks where user_id = auth.uid()`,
  which cascades to `ygo_deck_cards`. `auth.users` is not touched.
- Catalogue `tcg_printings` being removed upstream → clears the
  affected `preferred_tcg_printing_id` (SET NULL). The deck entry
  survives; the app re-picks a representative printing.

## When we get a real canonical card id

The upgrade path is:

1. Add nullable `ygo_deck_cards.canonical_card_id` (whatever type
   the new identity uses).
2. Backfill from `card_key` via the new mapping table.
3. Add a matching unique constraint on
   `(deck_id, section, canonical_card_id)`; leave the existing
   `card_key` unique in place until backfill is complete.
4. Swap the app read path over.
5. Drop `card_key` / `card_name` columns (or keep as denormalised
   caches).

Nothing about the RLS surface or the cascade behaviour changes.
