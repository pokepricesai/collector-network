# Collector Network schema request — Slice CN-B (v3, final)

Status: **APPLIED — CN-B closed.**

- Migration in production on preflightluke's project.
- App layer (packages/auth customer API, shared consent copy,
  network-ui EmailPreferences, YGO signup checkboxes + auth
  callback, /settings + /email-preferences) deployed to
  https://ygoprices.io.
- Live pen test `pnpm audit:cn-b` — 47/47 PASS (includes the
  full updateUser attack scenario, tri-state A–E, active-site
  enforcement, immutable snapshot proofs).
- CN-A backfill: **4 rows** — see
  docs/network/backfill-cn-a-ygo.md.
- Not started (deliberately): Brevo custom SMTP, branded auth
  emails, newsletter sync.

## Original v3 spec (retained for history)

Supersedes v1 + v2. Same tables + trigger as v2. Three
corrections applied:

1. **Consent-version seed uses `ON CONFLICT (id) DO NOTHING`.**
   A re-run of this historical migration must never overwrite a
   later-bumped current version. Wording/version changes get
   their own explicit migration.
2. **`collector_sites.active` respected on membership +
   origin-capture paths.** The signup-context trigger drops the
   origin to NULL if the origin site is inactive.
   `record_site_visit` and `record_site_authentication` raise
   on inactive sites. Existing historical rows are untouched.
   The two snapshot-reading RPCs
   (`record_origin_from_signup`, `apply_signup_marketing_consent`)
   trust the snapshot (site was active at capture) and do not
   re-check — a historical origin remains a historical fact.
3. **Unchecked signup checkbox = OMITTED metadata key.** The
   DB continues to accept nullable booleans and continues to
   understand `false` from Settings / Preference Centre paths;
   the signup UI must never send `false` merely because a box
   was left unchecked. This preserves the tri-state model:
   `no recorded preference` / `opted in` / `explicitly opted
   out`. Documented at the trigger comments and enforced in
   application code (see the follow-up UI work).

## What this migration does NOT do

- Does not touch `collector_sites`, `collector_user_sites`,
  `collector_marketing_preferences`, or
  `collector_marketing_consent_events` schemas / RLS.
- Does not touch `auth.users` schema, SMTP, or email templates.
- Does not backfill snapshots for existing users. Legacy users
  stay snapshot-less → origin null forever → signup consent
  absent forever.
- Does not deactivate or delete any registry row. `onepiece` /
  `lorcana` retain their existing `active = false` from CN-A;
  no historical data is destroyed.

## Migration

Idempotent; single transaction; safe to re-run.

```sql
begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Consent version registry
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_consent_versions (
  id          text primary key,
  version     text not null,
  updated_at  timestamptz not null default now()
);

-- Seed the current signup version ONLY if the row does not
-- already exist. A future wording change gets its own migration.
-- Re-running this historical migration never regresses the
-- current version.
insert into collector_consent_versions (id, version) values
  ('signup', '2026-09-v1')
on conflict (id) do nothing;

alter table collector_consent_versions enable row level security;

drop policy if exists "consent versions readable" on collector_consent_versions;
create policy "consent versions readable"
  on collector_consent_versions for select
  to anon, authenticated
  using (true);
-- No mutation policies. Bumped by DB admin / migration only.

-- ─────────────────────────────────────────────────────────────
-- 2. Immutable signup-context snapshot
-- ─────────────────────────────────────────────────────────────

create table if not exists collector_signup_context (
  user_id                    uuid primary key
                             references auth.users(id) on delete cascade,
  origin_site_code           text references collector_sites(code) on delete restrict,
  site_marketing_intent      boolean,
  network_marketing_intent   boolean,
  consent_text_version       text not null,
  captured_at                timestamptz not null default now()
);

create index if not exists collector_signup_context_origin_idx
  on collector_signup_context (origin_site_code);

alter table collector_signup_context enable row level security;

drop policy if exists "user reads own signup context" on collector_signup_context;
create policy "user reads own signup context"
  on collector_signup_context for select
  using (auth.uid() = user_id);
-- Deliberately: NO insert, update, delete policies. Ordinary
-- authenticated users cannot mutate their own historical
-- signup record. The AFTER INSERT trigger below is the sole
-- writer (SECURITY DEFINER bypasses RLS at postgres privilege).

-- ─────────────────────────────────────────────────────────────
-- 3. AFTER INSERT trigger on auth.users
--
-- Snapshot conventions (documented for future maintainers):
--   • collector_origin_site: string site code. Must match an
--     ACTIVE row in collector_sites; otherwise dropped to NULL.
--   • collector_site_marketing_opt_in: literal JSON boolean if
--     the user affirmatively chose. ABSENT KEY means "no
--     preference recorded"; the signup UI must not send `false`
--     merely because an optional checkbox was left unchecked.
--   • collector_network_marketing_opt_in: same rules.
-- ─────────────────────────────────────────────────────────────

create or replace function public.collector_capture_signup_context()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta       jsonb;
  v_site       text;
  v_site_opt   boolean;
  v_net_opt    boolean;
  v_version    text;
begin
  v_meta := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);

  -- ── origin_site_code (site must EXIST + be ACTIVE) ──
  v_site := v_meta ->> 'collector_origin_site';
  if v_site is not null then
    if length(v_site) < 2 then
      v_site := null;
    elsif not exists (
      select 1 from public.collector_sites
      where code = v_site and active = true
    ) then
      -- Site unknown OR inactive. Drop to NULL rather than
      -- silently attributing to an inactive brand.
      v_site := null;
    end if;
  end if;

  -- ── site_marketing_intent (literal JSON boolean only) ──
  -- ABSENT key → NULL (tri-state: "no preference recorded").
  if v_meta ? 'collector_site_marketing_opt_in' then
    if jsonb_typeof(v_meta -> 'collector_site_marketing_opt_in') = 'boolean' then
      v_site_opt := (v_meta ->> 'collector_site_marketing_opt_in')::boolean;
    end if;
  end if;

  -- ── network_marketing_intent (literal JSON boolean only) ─
  if v_meta ? 'collector_network_marketing_opt_in' then
    if jsonb_typeof(v_meta -> 'collector_network_marketing_opt_in') = 'boolean' then
      v_net_opt := (v_meta ->> 'collector_network_marketing_opt_in')::boolean;
    end if;
  end if;

  -- ── consent_text_version (server-owned) ──────────
  select version into v_version
    from public.collector_consent_versions
    where id = 'signup';
  if v_version is null then
    -- Registry row missing: refuse to snapshot rather than
    -- capture a bogus version. Signup still succeeds.
    return NEW;
  end if;

  -- Snapshot. Defensive: wrap in EXCEPTION so any DB weirdness
  -- (FK race, disk full, etc) never blocks signup. Once written
  -- the row is immutable - trigger fires AFTER INSERT and does
  -- nothing on subsequent auth.users updates.
  begin
    insert into public.collector_signup_context (
      user_id,
      origin_site_code,
      site_marketing_intent,
      network_marketing_intent,
      consent_text_version,
      captured_at
    ) values (
      NEW.id,
      v_site,
      v_site_opt,
      v_net_opt,
      v_version,
      now()
    )
    on conflict (user_id) do nothing;
  exception
    when others then
      raise notice 'collector_capture_signup_context error: %', sqlerrm;
  end;

  return NEW;
end;
$$;

revoke all on function public.collector_capture_signup_context() from public;

drop trigger if exists collector_capture_signup_context_trg on auth.users;
create trigger collector_capture_signup_context_trg
  after insert on auth.users
  for each row
  execute function public.collector_capture_signup_context();

-- ─────────────────────────────────────────────────────────────
-- 4. Membership RPCs — sites must be EXIST + ACTIVE
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
  if not exists (
    select 1 from public.collector_sites
    where code = p_site_code and active = true
  ) then
    raise exception 'unknown or inactive site code';
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
  if not exists (
    select 1 from public.collector_sites
    where code = p_site_code and active = true
  ) then
    raise exception 'unknown or inactive site code';
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

-- ─────────────────────────────────────────────────────────────
-- 5. record_origin_from_signup() — reads snapshot only
--
-- Deliberately does NOT re-check collector_sites.active. The
-- snapshot was created only when the site was active at signup
-- time; the origin is a historical fact and should not disappear
-- if the site is later deactivated.
-- ─────────────────────────────────────────────────────────────

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

  if exists (
    select 1 from public.collector_user_sites
    where user_id = v_user and originated_here
  ) then
    return;
  end if;

  select origin_site_code into v_site
    from public.collector_signup_context
    where user_id = v_user;

  if v_site is null then
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
-- 6. Ordinary preference RPCs — restricted sources only
-- ─────────────────────────────────────────────────────────────

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
  if p_source not in ('settings','preference_center') then
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
  if p_source not in ('settings','preference_center') then
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

-- ─────────────────────────────────────────────────────────────
-- 7. apply_signup_marketing_consent() — NO ARGUMENTS
--    Reads from the IMMUTABLE snapshot; trusts snapshot values.
-- ─────────────────────────────────────────────────────────────

create or replace function public.apply_signup_marketing_consent()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_site       text;
  v_site_opt   boolean;
  v_net_opt    boolean;
  v_version    text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select origin_site_code,
         site_marketing_intent,
         network_marketing_intent,
         consent_text_version
    into v_site, v_site_opt, v_net_opt, v_version
    from public.collector_signup_context
    where user_id = v_user;

  if v_version is null then
    return;
  end if;

  -- ── Site preference (if intent + site captured) ──────
  if v_site_opt is not null and v_site is not null then
    if not exists (
      select 1 from public.collector_marketing_preferences
      where user_id = v_user and scope = 'site' and site_code = v_site
    ) then
      insert into public.collector_marketing_preferences (
        user_id, scope, site_code, email_opt_in,
        consented_at, withdrawn_at,
        consent_source, consent_text_version
      ) values (
        v_user, 'site', v_site, v_site_opt,
        case when v_site_opt then now() else null end,
        case when v_site_opt then null  else now() end,
        'signup', v_version
      );

      insert into public.collector_marketing_consent_events (
        user_id, scope, site_code, action, source, consent_text_version
      ) values (
        v_user, 'site', v_site,
        case when v_site_opt then 'opt_in' else 'opt_out' end,
        'signup', v_version
      );
    end if;
  end if;

  -- ── Network preference (if intent captured) ─────────
  if v_net_opt is not null then
    if not exists (
      select 1 from public.collector_marketing_preferences
      where user_id = v_user and scope = 'network'
    ) then
      insert into public.collector_marketing_preferences (
        user_id, scope, site_code, email_opt_in,
        consented_at, withdrawn_at,
        consent_source, consent_text_version
      ) values (
        v_user, 'network', null, v_net_opt,
        case when v_net_opt then now() else null end,
        case when v_net_opt then null  else now() end,
        'signup', v_version
      );

      insert into public.collector_marketing_consent_events (
        user_id, scope, site_code, action, source, consent_text_version
      ) values (
        v_user, 'network', null,
        case when v_net_opt then 'opt_in' else 'opt_out' end,
        'signup', v_version
      );
    end if;
  end if;
end;
$$;

revoke all on function public.apply_signup_marketing_consent() from public;
grant execute on function public.apply_signup_marketing_consent() to authenticated;

commit;
```

## After apply

Continue with the CN-B app-side work:

- YGO signup UI: unchecked box = OMITTED metadata key (never
  send `false`). Follow-up tests A–E prove tri-state.
- `packages/network-config`: shared consent copy registry
  (labels, descriptions, version constant matching the DB).
- `packages/auth`: typed wrapper for
  `apply_signup_marketing_consent()` (no args) and read helpers
  for `collector_signup_context` + `collector_consent_versions`.
- YGO auth callback: `record_origin_from_signup()` +
  `apply_signup_marketing_consent()` + `record_site_authentication('ygo')`.
- Shared `EmailPreferences` component consumed by `/settings`
  and new `/email-preferences` route (noindex, tri-state
  aware — "no recorded preference" is distinct from "opted
  out").
- Extended pen test proving the `updateUser` attack, the
  active-site enforcement, and unchecked-box tri-state
  behaviour (A–E).

STOP - waiting for you to apply this migration.
