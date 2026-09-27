# Schema request — `op_collection_items`

Status: **paste into the Supabase SQL editor for the shared
Collector Network project**.

This adds OP collection support (add / list / edit / delete raw and
graded holdings; per-holding valuation; summary analytics).

**1:1 analogue of `docs/yugioh/schema-request-slice-d.md`** — the only
differences are the table name, the trigger/function names, and the
policy owner-quoted string. Everything else — column shape,
constraints, indexes, RLS wiring — is byte-for-byte identical.
`packages/database` and `packages/market-data` treat OP rows through
the same `tcg_*` schema, so this table participates in the same
valuation pipeline as `ygo_collection_items`.

The consumer (`apps/onepiece/src/server/collection.ts`) already
fail-softs to a friendly "schema pending" panel when the table is
missing, so a deployment before this migration is applied does not
500.

## Migration

Run the whole block as one transaction in the Supabase SQL editor.
Safe to re-run — every statement is idempotent.

```sql
begin;

create table if not exists op_collection_items (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  tcg_card_id       text not null references tcg_cards(id) on delete cascade,
  -- Every holding is pinned to an exact printing. `restrict` prevents
  -- silently orphaning a holding if catalogue data churns; a printing
  -- referenced by any collection row cannot be deleted upstream.
  tcg_printing_id   text not null references tcg_printings(id) on delete restrict,
  quantity          integer not null default 1 check (quantity > 0),
  is_graded         boolean not null default false,
  -- `any` is a market-data rollup value only; it is NOT a real
  -- grader for an owned slab and is not permitted here.
  grader            text check (grader in ('psa','bgs','cgc','sgc')),
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
alter table op_collection_items
  drop constraint if exists op_collection_items_graded_shape;
alter table op_collection_items add constraint op_collection_items_graded_shape
  check (
    (is_graded = true  and grader is not null and grade is not null)
    or
    (is_graded = false and grader is null and grade is null)
  );

-- Purchase-price shape: a numeric price is meaningless without a
-- currency (we never FX-convert). Currency may be null when no
-- price has been supplied.
alter table op_collection_items
  drop constraint if exists op_collection_items_purchase_shape;
alter table op_collection_items add constraint op_collection_items_purchase_shape
  check (
    purchase_price is null
    or (purchase_price is not null and purchase_currency is not null)
  );

-- Owner-first indexes for the two hot query patterns:
-- (1) list a user's whole collection,
-- (2) resolve "does this user already own printing X".
create index if not exists op_collection_items_user_id_idx
  on op_collection_items (user_id);
create index if not exists op_collection_items_user_printing_idx
  on op_collection_items (user_id, tcg_printing_id);

alter table op_collection_items enable row level security;

drop policy if exists "owner reads own holdings"    on op_collection_items;
drop policy if exists "owner inserts own holdings"  on op_collection_items;
drop policy if exists "owner updates own holdings"  on op_collection_items;
drop policy if exists "owner deletes own holdings"  on op_collection_items;

create policy "owner reads own holdings"
  on op_collection_items
  for select using (auth.uid() = user_id);

create policy "owner inserts own holdings"
  on op_collection_items
  for insert with check (auth.uid() = user_id);

create policy "owner updates own holdings"
  on op_collection_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "owner deletes own holdings"
  on op_collection_items
  for delete using (auth.uid() = user_id);

-- Keep updated_at fresh on every write.
create or replace function op_touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists op_collection_items_touch_updated_at
  on op_collection_items;
create trigger op_collection_items_touch_updated_at
  before update on op_collection_items
  for each row execute function op_touch_updated_at();

commit;
```

## Cascade on account deletion

Identical to YGO: `op_collection_items.user_id` FK uses
`on delete cascade` from `auth.users`. A full network account
deletion cascades OP holdings. A YGO-only or OP-only profile
delete is handled explicitly by the app (`deleteAllForCurrentUser`).

## Uniqueness / identity model

Same as YGO: deliberately no unique constraint on
`(user_id, tcg_printing_id, is_graded, grader, grade, condition)`.
Two rows that differ by purchase context must remain independently
trackable. The consumer merges by `(printing × raw/graded × grade)`
for summary counters but never overwrites rows.

## Consumer

`apps/onepiece/src/server/collection.ts` is the sole consumer.
It uses the caller's own Supabase session (anon key + user JWT), so
RLS alone enforces every read/write. No service-role usage.

## Verification

After applying, `apps/onepiece/src/server/collection.ts::listCollectionForCurrentUser`
should return `{ ok: true, value: { items: [], summary: … } }` for a
signed-in user with no holdings, not `{ ok: false, reason: 'table-missing' }`.
The `/collection` UI switches from the "schema pending" panel to the
empty-state ("Add your first card") when this succeeds.
