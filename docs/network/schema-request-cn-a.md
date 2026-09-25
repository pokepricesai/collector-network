# Collector Network schema request — Slice CN-A (v2, hardened)

Status: **paste into the Supabase SQL editor for the shared
Collector Network project (preflightluke)**.

Supersedes the v1 draft. Three integrity issues fixed:

1. **User-facing consent RPCs reject `admin` / `migration` /
   `brevo_webhook` sources.** Those values remain valid on the
   table so future trusted server / admin / webhook paths can
   still write them; ordinary authenticated browsers cannot.
2. **Origin acquisition no longer accepts a site parameter.** The
   frontend embeds `collector_origin_site` in Supabase signup
   metadata (`options.data.collector_origin_site`). The RPC
   reads that value from `auth.users.raw_user_meta_data`,
   validates it, and records origin only if none exists.
3. **`p_text_version` is required and non-blank on both user
   RPCs.**

Also: `onepiece` and `lorcana` seeded with `active = false` until
those sites actually launch. Their rows exist so the RPCs can
reference them, but they are not treated as live.

Everything else from v1 unchanged:
- `collector_sites` / `collector_user_sites` /
  `collector_marketing_preferences` /
  `collector_marketing_consent_events`
- `unique (user_id, site_code)` + partial unique origin index
- `SECURITY DEFINER` + `search_path = ''` + fully-qualified
  `public.*` relations
- Owner-only read RLS; zero direct-mutation policies from
  authenticated clients
- Atomic (preference-state + consent-event) writes in the same
  RPC body

## Signup-metadata contract

Each site's frontend must, at signup time, pass its site code in
Supabase's `options.data`:

```ts
await supabase.auth.signUp({
  email, password,
  options: {
    emailRedirectTo: '…/auth/callback',
    data: { collector_origin_site: 'ygo' },  // 'pokemon' / 'mtg' / …
  },
});
```

This lands in `auth.users.raw_user_meta_data.collector_origin_site`
and is baked in at account creation. After the confirmation link
returns an authenticated session, the site's auth callback calls
`record_origin_from_signup()` **server-side once** (the same
callback that finalises the session). Users whose signup pre-dates
this convention have no key set → origin stays null forever,
matching the "existing users' true origin is unknown" rule.

## Migration

Idempotent; single transaction. Safe to re-run.

```sql
begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Site registry
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_sites (
  code        text primary key check (length(code) between 2 and 24),
  brand_name  text not null,
  domain      text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function collector_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists collector_sites_touch_updated_at on collector_sites;
create trigger collector_sites_touch_updated_at
  before update on collector_sites
  for each row execute function collector_touch_updated_at();

-- Seed all five known sites. `active` reflects launch state, not
-- planned existence: onepiece + lorcana are false until they
-- actually launch.
insert into collector_sites (code, brand_name, domain, active) values
  ('pokemon',  'PokePrices',           'pokeprices.io', true),
  ('mtg',      'MTGPrices',            'mtgprices.io',  true),
  ('ygo',      'YGOPrices',            'ygoprices.io',  true),
  ('onepiece', 'One Piece Card Game',  null,            false),
  ('lorcana',  'Disney Lorcana',       null,            false)
on conflict (code) do update
  set brand_name = excluded.brand_name,
      domain     = excluded.domain,
      active     = excluded.active;

alter table collector_sites enable row level security;

drop policy if exists "sites readable by anyone" on collector_sites;
create policy "sites readable by anyone"
  on collector_sites for select
  to anon, authenticated
  using (true);

-- ─────────────────────────────────────────────────────────────
-- 2. Site membership
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_user_sites (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id)      on delete cascade,
  site_code                 text not null references collector_sites(code) on delete restrict,
  originated_here           boolean not null default false,
  first_seen_at             timestamptz not null default now(),
  first_authenticated_at    timestamptz,
  last_seen_at              timestamptz not null default now(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table collector_user_sites
  drop constraint if exists collector_user_sites_unique_user_site;
alter table collector_user_sites add constraint collector_user_sites_unique_user_site
  unique (user_id, site_code);

create unique index if not exists collector_user_sites_one_origin_per_user
  on collector_user_sites (user_id) where originated_here;

create index if not exists collector_user_sites_user_id_idx
  on collector_user_sites (user_id);

drop trigger if exists collector_user_sites_touch_updated_at on collector_user_sites;
create trigger collector_user_sites_touch_updated_at
  before update on collector_user_sites
  for each row execute function collector_touch_updated_at();

alter table collector_user_sites enable row level security;

drop policy if exists "user reads own memberships" on collector_user_sites;
create policy "user reads own memberships"
  on collector_user_sites for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 3. Marketing preferences (current state)
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_marketing_preferences (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id)      on delete cascade,
  scope                text not null check (scope in ('site','network')),
  site_code            text references collector_sites(code)        on delete restrict,
  email_opt_in         boolean not null default false,
  consented_at         timestamptz,
  withdrawn_at         timestamptz,
  -- All six sources valid at the column level so admin /
  -- migration / brevo_webhook paths can write them. User-facing
  -- RPCs deny the last three at the boundary.
  consent_source       text not null check (consent_source in
                         ('signup','settings','preference_center','admin','migration','brevo_webhook')),
  consent_text_version text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table collector_marketing_preferences
  drop constraint if exists collector_marketing_preferences_scope_shape;
alter table collector_marketing_preferences add constraint collector_marketing_preferences_scope_shape
  check (
    (scope = 'site'    and site_code is not null)
    or
    (scope = 'network' and site_code is null)
  );

create unique index if not exists collector_marketing_prefs_one_per_user_site
  on collector_marketing_preferences (user_id, site_code) where scope = 'site';
create unique index if not exists collector_marketing_prefs_one_per_user_network
  on collector_marketing_preferences (user_id) where scope = 'network';

create index if not exists collector_marketing_prefs_user_id_idx
  on collector_marketing_preferences (user_id);

drop trigger if exists collector_marketing_prefs_touch_updated_at on collector_marketing_preferences;
create trigger collector_marketing_prefs_touch_updated_at
  before update on collector_marketing_preferences
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_preferences enable row level security;

drop policy if exists "user reads own marketing preferences" on collector_marketing_preferences;
create policy "user reads own marketing preferences"
  on collector_marketing_preferences for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 4. Consent event history (append-only from user paths)
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_marketing_consent_events (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id)      on delete cascade,
  scope                text not null check (scope in ('site','network')),
  site_code            text references collector_sites(code)        on delete restrict,
  action               text not null check (action in ('opt_in','opt_out')),
  source               text not null check (source in
                         ('signup','settings','preference_center','admin','migration','brevo_webhook')),
  consent_text_version text,
  occurred_at          timestamptz not null default now()
);

alter table collector_marketing_consent_events
  drop constraint if exists collector_marketing_consent_events_scope_shape;
alter table collector_marketing_consent_events add constraint collector_marketing_consent_events_scope_shape
  check (
    (scope = 'site'    and site_code is not null)
    or
    (scope = 'network' and site_code is null)
  );

create index if not exists collector_marketing_consent_events_user_idx
  on collector_marketing_consent_events (user_id, occurred_at desc);

alter table collector_marketing_consent_events enable row level security;

drop policy if exists "user reads own consent events" on collector_marketing_consent_events;
create policy "user reads own consent events"
  on collector_marketing_consent_events for select
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 5. Membership RPCs
-- ─────────────────────────────────────────────────────────────

create or replace function public.record_site_visit(p_site_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_site_code is null or length(p_site_code) < 2 then
    raise exception 'invalid site code';
  end if;
  if not exists (select 1 from public.collector_sites where code = p_site_code) then
    raise exception 'unknown site code';
  end if;
  insert into public.collector_user_sites (user_id, site_code, first_seen_at, last_seen_at)
  values (v_user, p_site_code, now(), now())
  on conflict (user_id, site_code) do update
    set last_seen_at = excluded.last_seen_at;
end;
$$;

revoke all on function public.record_site_visit(text) from public;
grant execute on function public.record_site_visit(text) to authenticated;

create or replace function public.record_site_authentication(p_site_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_site_code is null or length(p_site_code) < 2 then
    raise exception 'invalid site code';
  end if;
  if not exists (select 1 from public.collector_sites where code = p_site_code) then
    raise exception 'unknown site code';
  end if;
  insert into public.collector_user_sites (
    user_id, site_code, first_seen_at, first_authenticated_at, last_seen_at
  ) values (v_user, p_site_code, now(), now(), now())
  on conflict (user_id, site_code) do update
    set first_authenticated_at = coalesce(public.collector_user_sites.first_authenticated_at, now()),
        last_seen_at            = now();
end;
$$;

revoke all on function public.record_site_authentication(text) from public;
grant execute on function public.record_site_authentication(text) to authenticated;

-- Origin acquisition. NO SITE PARAMETER. Reads the site code from
-- the caller's own signup metadata (`raw_user_meta_data
-- .collector_origin_site`, set by the site's signup form). The
-- user cannot self-attribute post-hoc because origin is immutable
-- once set and the value is baked in at account creation.
create or replace function public.record_origin_from_signup()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_site text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- If origin is already known for this user, stop. Immutable.
  if exists (
    select 1 from public.collector_user_sites
    where user_id = v_user and originated_here
  ) then
    return;
  end if;

  -- Read the site code the frontend set at signup. Old accounts
  -- pre-CN-A have no such key; they simply stay origin-null.
  select raw_user_meta_data ->> 'collector_origin_site'
    into v_site
    from auth.users
    where id = v_user;

  if v_site is null or length(v_site) < 2 then
    return;
  end if;

  -- Refuse unknown site codes silently rather than raising, so a
  -- typo in one site's signup form does not break its auth
  -- callback. The origin simply stays unrecorded.
  if not exists (select 1 from public.collector_sites where code = v_site) then
    return;
  end if;

  insert into public.collector_user_sites (
    user_id, site_code, originated_here,
    first_seen_at, first_authenticated_at, last_seen_at
  ) values (v_user, v_site, true, now(), now(), now())
  on conflict (user_id, site_code) do update
    set originated_here        = true,
        first_authenticated_at = coalesce(public.collector_user_sites.first_authenticated_at, now()),
        last_seen_at           = now();
end;
$$;

revoke all on function public.record_origin_from_signup() from public;
grant execute on function public.record_origin_from_signup() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 6. Marketing-preference RPCs (state + immutable event, atomic)
-- ─────────────────────────────────────────────────────────────

-- Sources allowed from a signed-in browser session. The full six-
-- value column CHECK on the tables still lets admin / migration /
-- brevo_webhook paths write via their own trusted callers.
--   'signup'            → from a signup consent checkbox
--   'settings'          → from the account settings screen
--   'preference_center' → from a one-click preference-centre URL
create or replace function public.set_site_marketing_preference(
  p_site_code    text,
  p_opt_in       boolean,
  p_source       text,
  p_text_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_site_code is null then
    raise exception 'missing site code';
  end if;
  if not exists (select 1 from public.collector_sites where code = p_site_code) then
    raise exception 'unknown site code';
  end if;
  if p_source not in ('signup','settings','preference_center') then
    raise exception 'source not allowed from user session';
  end if;
  if p_text_version is null or length(btrim(p_text_version)) = 0 then
    raise exception 'consent text version required';
  end if;

  insert into public.collector_marketing_preferences (
    user_id, scope, site_code, email_opt_in,
    consented_at, withdrawn_at,
    consent_source, consent_text_version
  ) values (
    v_user, 'site', p_site_code, p_opt_in,
    case when p_opt_in then now() else null end,
    case when p_opt_in then null  else now() end,
    p_source, p_text_version
  )
  on conflict (user_id, site_code) where scope = 'site' do update
    set email_opt_in         = excluded.email_opt_in,
        consented_at         = case when excluded.email_opt_in
                                    then now()
                                    else public.collector_marketing_preferences.consented_at
                               end,
        withdrawn_at         = case when excluded.email_opt_in
                                    then null
                                    else now()
                               end,
        consent_source       = excluded.consent_source,
        consent_text_version = excluded.consent_text_version;

  insert into public.collector_marketing_consent_events (
    user_id, scope, site_code, action, source, consent_text_version
  ) values (
    v_user, 'site', p_site_code,
    case when p_opt_in then 'opt_in' else 'opt_out' end,
    p_source, p_text_version
  );
end;
$$;

revoke all on function public.set_site_marketing_preference(text, boolean, text, text) from public;
grant execute on function public.set_site_marketing_preference(text, boolean, text, text) to authenticated;

create or replace function public.set_network_marketing_preference(
  p_opt_in       boolean,
  p_source       text,
  p_text_version text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_source not in ('signup','settings','preference_center') then
    raise exception 'source not allowed from user session';
  end if;
  if p_text_version is null or length(btrim(p_text_version)) = 0 then
    raise exception 'consent text version required';
  end if;

  insert into public.collector_marketing_preferences (
    user_id, scope, site_code, email_opt_in,
    consented_at, withdrawn_at,
    consent_source, consent_text_version
  ) values (
    v_user, 'network', null, p_opt_in,
    case when p_opt_in then now() else null end,
    case when p_opt_in then null  else now() end,
    p_source, p_text_version
  )
  on conflict (user_id) where scope = 'network' do update
    set email_opt_in         = excluded.email_opt_in,
        consented_at         = case when excluded.email_opt_in
                                    then now()
                                    else public.collector_marketing_preferences.consented_at
                               end,
        withdrawn_at         = case when excluded.email_opt_in
                                    then null
                                    else now()
                               end,
        consent_source       = excluded.consent_source,
        consent_text_version = excluded.consent_text_version;

  insert into public.collector_marketing_consent_events (
    user_id, scope, site_code, action, source, consent_text_version
  ) values (
    v_user, 'network', null,
    case when p_opt_in then 'opt_in' else 'opt_out' end,
    p_source, p_text_version
  );
end;
$$;

revoke all on function public.set_network_marketing_preference(boolean, text, text) from public;
grant execute on function public.set_network_marketing_preference(boolean, text, text) to authenticated;

commit;
```

## What this migration does NOT do

- Does not touch `auth.users` schema, the shared Site URL, or
  Supabase auth email settings.
- Does not modify any existing YGOPrices per-user table
  (`ygo_collection_items`, `ygo_watchlist_items`, `ygo_decks`,
  `ygo_deck_cards`) or `user_metadata.ygo`.
- Does not create membership rows for existing users. Backfill is
  a separate, evidence-based step run after apply.
- Does not create marketing opt-in rows. Account creation implies
  nothing.
- Does not touch Brevo, SMTP, email templates, or auth-mail
  configuration.
- Defines no admin/migration/webhook write paths. The
  `admin` / `migration` / `brevo_webhook` source values exist on
  the tables so those future paths can write them; nothing in this
  migration exposes such a path.
