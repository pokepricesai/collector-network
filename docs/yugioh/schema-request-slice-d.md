# Slice D schema request — `ygo_collection_items`

Status: **paste into the Supabase SQL editor for the shared
Collector Network project**.

Slice D ships full YGO collection support (add / list / edit / delete
raw and graded holdings; per-holding valuation; summary analytics).
The consumer code assumes this table exists with owner-only RLS; it
fail-softs to a friendly panel when the table is missing so a
deployment before this migration is applied does not 500.

## Migration

Run the whole block as one transaction in the Supabase SQL editor.
Safe to re-run — every statement is idempotent.

```sql
begin;

create table if not exists ygo_collection_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tcg_card_id       text not null references tcg_cards(id) on delete cascade,
  tcg_printing_id   text references tcg_printings(id) on delete set null,
  quantity          integer not null default 1 check (quantity > 0),
  is_graded         boolean not null default false,
  grader            text check (grader in ('psa','bgs','cgc','sgc','any')),
  grade             text,
  condition         text check (condition in (
                      'mint',
                      'near-mint',
                      'lightly-played',
                      'moderately-played',
                      'heavily-played',
                      'damaged'
                    )),
  purchase_price    numeric(12,2) check (purchase_price is null or purchase_price >= 0),
  purchase_currency text check (purchase_currency in ('USD','EUR')),
  purchase_date     date,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- A graded row must carry a grader + grade; a raw row must not
-- carry a grader value that would confuse valuation.
alter table ygo_collection_items
  drop constraint if exists ygo_collection_items_graded_shape;
alter table ygo_collection_items add constraint ygo_collection_items_graded_shape
  check (
    (is_graded = true  and grader is not null and grade is not null)
    or
    (is_graded = false and grader is null and grade is null)
  );

-- Owner-first indexes for the two hot query patterns:
-- (1) list a user's whole collection,
-- (2) resolve "does this user already own printing X".
create index if not exists ygo_collection_items_user_id_idx
  on ygo_collection_items (user_id);
create index if not exists ygo_collection_items_user_printing_idx
  on ygo_collection_items (user_id, tcg_printing_id);

alter table ygo_collection_items enable row level security;

drop policy if exists "owner reads own holdings"    on ygo_collection_items;
drop policy if exists "owner inserts own holdings"  on ygo_collection_items;
drop policy if exists "owner updates own holdings"  on ygo_collection_items;
drop policy if exists "owner deletes own holdings"  on ygo_collection_items;

create policy "owner reads own holdings"
  on ygo_collection_items
  for select using (auth.uid() = user_id);

create policy "owner inserts own holdings"
  on ygo_collection_items
  for insert with check (auth.uid() = user_id);

create policy "owner updates own holdings"
  on ygo_collection_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner deletes own holdings"
  on ygo_collection_items
  for delete using (auth.uid() = user_id);

-- Optional but nice: keep updated_at fresh on every write.
create or replace function ygo_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists ygo_collection_items_touch_updated_at
  on ygo_collection_items;
create trigger ygo_collection_items_touch_updated_at
  before update on ygo_collection_items
  for each row execute function ygo_touch_updated_at();

commit;
```

## Cascade on account deletion

The `ygo_collection_items.user_id` FK uses `on delete cascade` from
`auth.users`. This means:

- If a shared-network account is **fully deleted** (via the
  Collector Network / auth.users), the user's YGO holdings go with
  it — correct.
- If the user only deletes their **YGOPrices profile** from the
  YGOPrices settings page, `auth.users` is **not** touched. The app
  handles YGO row cleanup explicitly:

  ```sql
  delete from ygo_collection_items where user_id = auth.uid();
  ```

  This runs from the caller's own session (RLS enforces
  `auth.uid() = user_id`).

## Uniqueness / identity model

Deliberately **no** unique constraint across `(user_id, tcg_printing_id,
is_graded, grader, grade, condition)`. Two rows that differ by
purchase_date or acquisition context (e.g. two PSA 10 copies bought
years apart) must remain independently trackable. The consumer merges
by `(printing × raw/graded × grade)` for the summary counters but
never overwrites rows.

## Consumer

`apps/yugioh/src/server/collection.ts` is the sole consumer. It
uses the caller's own Supabase session (anon key + user JWT), so RLS
alone enforces every read/write. No service-role usage.
