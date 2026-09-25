# Slice G schema request — public + unlisted decks

Status: **paste into the Supabase SQL editor for the shared
Collector Network project (preflightluke)**.

Slice G ships public + shareable decks on top of the Slice F
foundation. Owner-only editing is unchanged.

## Privacy model

Three levels stored on `ygo_decks.visibility`:

- `private` — owner only. Existing builder at `/decks/[id]`. No
  anonymous SELECT permitted at all.
- `unlisted` — accessible via an opaque share token only. **Not
  enumerable** through anonymous table reads.
- `public` — anyone can SELECT; safely enumerable via the anon
  key (that's the whole point).

## Access architecture

Two separate anon channels:

1. **Public decks** — a bounded anonymous RLS policy scoped
   strictly to `visibility='public'`. Anon can read only public
   decks; the same is true for `ygo_deck_cards` via a mirror
   policy. Public deck enumeration is intentional here.

2. **Unlisted decks** — accessed **only** through two
   `SECURITY DEFINER` RPCs. There is deliberately **no** anon
   SELECT policy that ever returns an unlisted row. An anonymous
   `SELECT * FROM ygo_decks` returns 0 unlisted rows regardless
   of what the user knows about visibility values.

   The RPCs (`get_shared_deck_by_token`,
   `get_shared_deck_cards_by_token`) return only the deck + its
   cards for a **correct** token. They:

   - refuse tokens shorter than 24 chars (no accidental empty-
     string bypass);
   - never return `user_id`, `share_token` or auth metadata;
   - never mutate;
   - never expose data for private or public decks;
   - never bypass owner controls for unrelated decks.

   Regenerating the token by the owner rotates
   `share_token` — the old URL stops working immediately.

## Slug + token strategy

- `public_slug` — `<slug-of-name>-<8-char-random>`. Immutable
  after first publish so renaming a deck doesn't break links.
  UNIQUE (nullable partial).
- `share_token` — 32-char base32 random (~160 bits entropy).
  UNIQUE (nullable partial). Regenerable by owner.
- `published_at` — set when a deck first becomes non-private;
  kept afterward so we can order public discovery lists.

## Migration

Wrap in one transaction. Idempotent — safe to re-run.

```sql
begin;

alter table ygo_decks
  add column if not exists visibility    text not null default 'private',
  add column if not exists public_slug   text,
  add column if not exists share_token   text,
  add column if not exists published_at  timestamptz;

alter table ygo_decks
  drop constraint if exists ygo_decks_visibility_check;
alter table ygo_decks add constraint ygo_decks_visibility_check
  check (visibility in ('private','unlisted','public'));

-- A public deck must carry a slug; an unlisted deck must carry
-- a token. Private has neither requirement (may still carry
-- them if the owner has previously published, so we can restore
-- the same URL on re-publish).
alter table ygo_decks
  drop constraint if exists ygo_decks_visibility_shape;
alter table ygo_decks add constraint ygo_decks_visibility_shape
  check (
    visibility = 'private'
    or (visibility = 'unlisted' and share_token is not null and length(share_token) >= 24)
    or (visibility = 'public'   and public_slug is not null and length(public_slug)  >= 3)
  );

create unique index if not exists ygo_decks_public_slug_key
  on ygo_decks (public_slug) where public_slug is not null;
create unique index if not exists ygo_decks_share_token_key
  on ygo_decks (share_token) where share_token is not null;
create index if not exists ygo_decks_public_recent_idx
  on ygo_decks (published_at desc) where visibility = 'public';

-- Anonymous SELECT policies. Adding these does NOT weaken the
-- existing owner-only INSERT/UPDATE/DELETE policies from Slice
-- F — RLS combines policies with OR for SELECT and independently
-- for other verbs.
drop policy if exists "public decks readable by anyone"      on ygo_decks;
drop policy if exists "public deck cards readable by anyone" on ygo_deck_cards;

create policy "public decks readable by anyone"
  on ygo_decks for select
  using (visibility = 'public');

create policy "public deck cards readable by anyone"
  on ygo_deck_cards for select
  using (
    exists (
      select 1 from ygo_decks d
      where d.id = ygo_deck_cards.deck_id
        and d.visibility = 'public'
    )
  );

-- Token-scoped anonymous read for unlisted decks. Runs as
-- SECURITY DEFINER so it bypasses RLS, but returns rows only
-- for the exact token supplied. Never returns user_id or
-- share_token.
create or replace function public.get_shared_deck_by_token(p_token text)
returns table (
  id           uuid,
  name         text,
  description  text,
  format       text,
  visibility   text,
  public_slug  text,
  created_at   timestamptz,
  updated_at   timestamptz,
  published_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.name, d.description, d.format, d.visibility,
         d.public_slug, d.created_at, d.updated_at, d.published_at
  from ygo_decks d
  where d.visibility = 'unlisted'
    and d.share_token = p_token
    and p_token is not null
    and length(p_token) >= 24;
$$;

revoke all on function public.get_shared_deck_by_token(text) from public;
grant execute on function public.get_shared_deck_by_token(text) to anon, authenticated;

create or replace function public.get_shared_deck_cards_by_token(p_token text)
returns setof public.ygo_deck_cards
language sql
security definer
set search_path = public, pg_temp
as $$
  select c.*
  from public.ygo_deck_cards c
  join public.ygo_decks d on d.id = c.deck_id
  where d.visibility = 'unlisted'
    and d.share_token = p_token
    and p_token is not null
    and length(p_token) >= 24;
$$;

revoke all on function public.get_shared_deck_cards_by_token(text) from public;
grant execute on function public.get_shared_deck_cards_by_token(text) to anon, authenticated;

commit;
```

## What the migration does NOT change

- Existing Slice F owner-only INSERT / UPDATE / DELETE policies
  on `ygo_decks` and `ygo_deck_cards` — untouched.
- Cascade delete of `ygo_deck_cards` when the parent deck is
  deleted — untouched. Deleting a deck therefore invalidates its
  public / unlisted URLs immediately.
- `auth.users` — never touched.

## Enumeration behaviour after migration

- Anonymous `SELECT * FROM ygo_decks` → returns public decks only.
- Anonymous `SELECT * FROM ygo_decks WHERE visibility='unlisted'` →
  returns 0 rows (the "public-only" policy doesn't match).
- Anonymous `SELECT * FROM ygo_decks WHERE visibility='private'` →
  returns 0 rows.
- Anonymous `SELECT get_shared_deck_by_token('bad-token')` → 0 rows.
- Anonymous `SELECT get_shared_deck_by_token('<correct-token>')` →
  the matching unlisted deck's public fields.
- Any UPDATE/DELETE by anon or non-owner → 0 rows (Slice F
  policies unchanged).

## Consumer

`apps/yugioh/src/server/deck-publishing.ts` (built after this
migration lands). Owner mutations run with the caller's session;
anon reads go via the same anon key already in browser/edge and
the shared read client. Never uses service role.
