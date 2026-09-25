# Slice E schema request — `ygo_watchlist_items`

Status: **paste into the Supabase SQL editor for the shared
Collector Network project (preflightluke)**.

Slice E ships first-class YGO watchlists — a lightweight "cards
I'm tracking" list layered on top of the same shared auth identity
already used by Slices C + D. Watchlists never live in
`auth.user_metadata`; this table is the sole store.

## Identity + FK model

- `user_id` — FK to `auth.users(id)` with `on delete cascade`.
  When the shared account is deleted, the user's YGO watchlist
  goes with it (mirrors the Slice D collection cascade).
- `tcg_card_id`, `tcg_printing_id` — catalogue FKs with
  `on delete restrict`. Never silently drop a user's watched item
  because the catalogue churned. (Slice D collection used
  `cascade`/`set null` at the time; Slice E tightens this because
  we now have a clearer position.)
- `tcg_printing_id` is NOT NULL. Watchlists track price movement
  on an *exact* printing — mixing rarities/editions/languages
  under one row would corrupt every 7D/30D/90D delta.

## Uniqueness

`unique(user_id, tcg_printing_id)` — duplicate watches for the
same exact printing add no value. Different printings of the same
card family remain independently trackable.

## Target price

Optional per row. If a numeric `target_price` is set,
`target_currency` must also be set (mirrors Slice D's
`purchase_shape` rule — we never FX-convert).

## Migration

Run as one transaction in the Supabase SQL editor. Every
statement is idempotent, so it is safe to re-run.

```sql
begin;

create table if not exists ygo_watchlist_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- Catalogue FKs use `restrict`: user data must never disappear
  -- because upstream catalogue rows churned.
  tcg_card_id       text not null references tcg_cards(id)     on delete restrict,
  tcg_printing_id   text not null references tcg_printings(id) on delete restrict,
  target_price      numeric(12,2) check (target_price is null or target_price >= 0),
  target_currency   text check (target_currency in ('USD','EUR')),
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One watch per (user, printing). Duplicate watches add no value.
alter table ygo_watchlist_items
  drop constraint if exists ygo_watchlist_items_user_printing_unique;
alter table ygo_watchlist_items add constraint ygo_watchlist_items_user_printing_unique
  unique (user_id, tcg_printing_id);

-- A numeric target price is meaningless without a currency
-- (we never FX-convert).
alter table ygo_watchlist_items
  drop constraint if exists ygo_watchlist_items_target_shape;
alter table ygo_watchlist_items add constraint ygo_watchlist_items_target_shape
  check (
    target_price is null
    or (target_price is not null and target_currency is not null)
  );

-- The (user_id, tcg_printing_id) unique index already covers
-- listing by user_id, but a plain user_id btree keeps generic
-- scans cheap.
create index if not exists ygo_watchlist_items_user_id_idx
  on ygo_watchlist_items (user_id);

alter table ygo_watchlist_items enable row level security;

drop policy if exists "owner reads own watchlist"    on ygo_watchlist_items;
drop policy if exists "owner inserts own watchlist"  on ygo_watchlist_items;
drop policy if exists "owner updates own watchlist"  on ygo_watchlist_items;
drop policy if exists "owner deletes own watchlist"  on ygo_watchlist_items;

create policy "owner reads own watchlist"
  on ygo_watchlist_items
  for select using (auth.uid() = user_id);

create policy "owner inserts own watchlist"
  on ygo_watchlist_items
  for insert with check (auth.uid() = user_id);

create policy "owner updates own watchlist"
  on ygo_watchlist_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner deletes own watchlist"
  on ygo_watchlist_items
  for delete using (auth.uid() = user_id);

-- Reuse the ygo_touch_updated_at() trigger function created in Slice D.
drop trigger if exists ygo_watchlist_items_touch_updated_at
  on ygo_watchlist_items;
create trigger ygo_watchlist_items_touch_updated_at
  before update on ygo_watchlist_items
  for each row execute function ygo_touch_updated_at();

commit;
```

## Consumer

`apps/yugioh/src/server/watchlist.ts` (to be created in Slice E
work after this migration lands). It uses the caller's own
Supabase session (anon key + user JWT), so RLS alone enforces
every read/write. No service-role usage.

## Cascade on account deletion

- Full shared-account deletion via `auth.users` → cascades and
  removes the user's YGO watchlist rows.
- YGO-only profile deletion via the settings DangerZone → the
  app runs `delete from ygo_watchlist_items where user_id =
  auth.uid();` explicitly from the caller's session (Slice E
  extends the existing collection-wipe flow). `auth.users` is
  never touched.
