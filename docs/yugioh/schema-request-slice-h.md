# Slice H schema request — harden the deck-share RPCs

Status: **paste into the Supabase SQL editor for the shared
Collector Network project (preflightluke)**.

## What this changes

Tightens the two Slice G `SECURITY DEFINER` functions:

- `set search_path = ''` (no schema resolution at all — everything
  must be fully qualified);
- every relation reference is now `public.ygo_decks` /
  `public.ygo_deck_cards`;
- explicit `revoke all from public` before granting execute to
  `anon` + `authenticated` (already the case; re-stated for
  clarity);
- token-shape guard (`length(p_token) >= 24`) unchanged.

## Why

The current live definitions use `set search_path = public,
pg_temp` and reference `ygo_decks` without a schema prefix. In
this Supabase project that is *safe* today because `anon` /
`authenticated` roles cannot `CREATE` in `public` and cannot
shadow the base tables. This migration is defense-in-depth:
`search_path = ''` closes the class of schema-hijack risks
entirely, and fully-qualified relations make audits trivial to
verify by inspection.

## Migration

Idempotent. Safe to re-run.

```sql
begin;

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
set search_path = ''
as $$
  select d.id, d.name, d.description, d.format, d.visibility,
         d.public_slug, d.created_at, d.updated_at, d.published_at
  from public.ygo_decks d
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
set search_path = ''
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

## What this migration does NOT change

- Any RLS policy on `ygo_decks` or `ygo_deck_cards`.
- Column list returned by either RPC (still no `user_id` or
  `share_token`).
- Ownership, cascade, or trigger behaviour.
- `auth.users` — never touched.

## Verification

After apply, the existing security probe still passes:

```
pnpm audit:sec-share
```

Expected: 24/24 PASS (same set as Slice G — wrong / short / null
tokens still return zero rows; RPC still exposes only the safe
column set; unlisted decks still non-enumerable).
