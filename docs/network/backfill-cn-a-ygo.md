# CN-A backfill: existing YGO users → membership rows

Status: **paste into the Supabase SQL editor for preflightluke's
project after the CN-A migration is applied.**

## What this does

Creates a `collector_user_sites` row (site_code='ygo') for every
existing shared user with at least one row in:

- `ygo_collection_items`
- `ygo_watchlist_items`
- `ygo_decks`

## What this does NOT do

- Does not touch `originated_here`. Origin stays default `false`.
  We cannot prove where these accounts were first created; per
  Slice CN-A "Existing users whose original acquisition site is
  unknown must remain origin-null".
- Does not touch `first_authenticated_at`. We have no evidence of
  when the shared user authenticated on YGO; we only know they
  created row-level data at some point. The next real auth event
  will set that column via `record_site_authentication('ygo')`.
- Does not create marketing preference or consent-event rows.
  Account existence never implies subscription.
- Does not touch other sites. No membership row for `mtg`,
  `pokemon`, `onepiece` or `lorcana` is implied.

## Honest timestamps

Uses `min(created_at)` from the union of ygo_* tables as
`first_seen_at`, and `max(created_at)` as `last_seen_at`. Both
values are genuine "first / most recent time we know you used
YGO", not synthetic `now()` placeholders.

## SQL (idempotent, returns the count of new rows inserted)

```sql
with evidence as (
  select user_id,
         min(created_at) as earliest,
         max(created_at) as latest
  from (
    select user_id, created_at from ygo_collection_items
    union all
    select user_id, created_at from ygo_watchlist_items
    union all
    select user_id, created_at from ygo_decks
  ) t
  group by user_id
),
inserted as (
  insert into collector_user_sites (
    user_id, site_code, first_seen_at, last_seen_at
  )
  select user_id, 'ygo', earliest, latest
  from evidence
  on conflict (user_id, site_code) do nothing
  returning 1
)
select count(*) as backfilled_rows from inserted;
```

## Re-runnable

`on conflict (user_id, site_code) do nothing` means running this
SQL twice inserts nothing on the second run. The reported
`backfilled_rows` count on any subsequent run is `0`.

## After you run it

Paste the returned `backfilled_rows` number back to me. It will
be recorded in the final CN-A report as the audited existing-user
backfill.
