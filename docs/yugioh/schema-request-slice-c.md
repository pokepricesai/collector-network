# Slice C schema request — YGO user profile + preferences

Status: **proposal for the shared-schema owner**.

Slice C ships full auth + account + settings for YGOPrices using the
existing shared Supabase auth. Profile and preferences are currently
stored in `auth.users.user_metadata` under the `ygo` namespace so the
site can ship without waiting on schema.

For future queryability (leaderboards, admin views, cross-site
analytics), the shared-schema owner should consider moving this data
into first-class tables when convenient. This document is the
request.

## Proposed tables

Both keyed on `user_id references auth.users(id)`. Row-Level Security
must be **owner-only** — a user can read and update only their own
row.

```sql
create table ygo_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_key text check (avatar_key in
    ('dragon','spellcaster','trap','spell','star','eye','card-stack')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ygo_user_profiles enable row level security;
create policy "owner reads own profile" on ygo_user_profiles
  for select using (auth.uid() = user_id);
create policy "owner updates own profile" on ygo_user_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner inserts own profile" on ygo_user_profiles
  for insert with check (auth.uid() = user_id);
create policy "owner deletes own profile" on ygo_user_profiles
  for delete using (auth.uid() = user_id);

create table ygo_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferred_currency text
    check (preferred_currency in ('USD','EUR')) default 'USD',
  price_display text
    check (price_display in ('raw-and-graded','raw-only','graded-only'))
    default 'raw-and-graded',
  preferred_grader text
    check (preferred_grader in ('any','psa','bgs','cgc','sgc'))
    default 'any',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table ygo_user_preferences enable row level security;
create policy "owner reads own preferences" on ygo_user_preferences
  for select using (auth.uid() = user_id);
create policy "owner writes own preferences" on ygo_user_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Cascade delete on `auth.users` is intentional — if the shared Collector
Network account is fully deleted, YGO-specific rows go with it. The
in-app "delete YGOPrices data" flow does **not** touch `auth.users`;
it wipes the `ygo` namespace from `user_metadata` (or, once these
tables exist, deletes the two rows above and any collection/watchlist/
deck rows added by later slices).

## Consumer-side migration path

`apps/yugioh/src/lib/user-profile.ts` reads and writes the `ygo`
namespace inside `user_metadata`. When the tables land:

- Swap the read path to a `getServerSupabase().from('ygo_user_profiles')
  .select(...)` (still owner-only via RLS).
- Swap the write path from `supabase.auth.updateUser({ data: {...} })`
  to `.upsert({...})` against the tables.
- The three tests in `apps/yugioh/src/lib/user-profile.test.ts` stay
  useful — the validators and shape helpers don't care about storage.

No consumer of `user-profile.ts` outside that file needs to change.
