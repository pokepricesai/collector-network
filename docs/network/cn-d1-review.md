# CN-D1 pre-implementation review

Status: **CLOSED — 2026-09-26.** All 11 deployment steps applied,
all 3 live smoke tests PASS, cron at final `*/5 * * * *` cadence,
sync_failures = 0, email-drift nudge trigger installed and
proven. See "Live results" below and
`docs/network/schema-request-cn-d1-email-nudge.md` for the
post-Test-C trigger amendment.

## Live results (2026-09-26)

- **Gate A (PokePrices Resend audit):** PASS. Same workspace as
  CN-C. Existing state: legacy `General` segment, 2 `Untitled`
  broadcast drafts, PokePrices lifecycle/transactional domains.
  0 contacts, 0 topics pre-CN-D1.
- **Gate B (PATCH `/contacts/{id}/topics` semantics):** PASS.
  Additive/merge; omitted topics preserved. Observability via
  `GET /contacts/{id}/topics` (not the base contact object).
- **Backfill:** 7 managed contacts created from 7 users with
  actual `collector_marketing_preferences` rows. Zero
  membership-only leaks (Amendment 1 upheld).
- **Test A — YGO preference propagation:** PASS both directions
  (opt_in and opt_out). Same `resend_contact_id`, additive
  PATCH on `/topics`, no duplicate contact, network untouched.
  Cron picked up the change within one minute of each toggle.
- **Test B — network preference propagation:** PASS. Same
  contact, only the network topic subscription changed.
  `site:ygo` unchanged.
- **Test C — Secure Email Change / contact drift repair:**
  PASS. `AFTER UPDATE OF email ON auth.users` trigger installed
  (see `schema-request-cn-d1-email-nudge.md`) — enqueues one
  synthetic retry-queue row for managed contacts only, never
  for unmanaged users, fail-open so an auth-side email update
  can't be aborted by CN-D1. Test C proved the drift-repair
  flow: PATCH `/contacts/{id}` with new email, same
  `resend_contact_id`, no duplicate contact, segment + topics
  preserved.
- **Final Resend workspace state:** 8 managed contacts in
  `Collector Network Contacts`; 2 topics (`site:ygo`,
  `network`) both `default_subscription = opt_out`; General
  segment + 2 Untitled broadcast drafts untouched; no new
  broadcast created; no MTG / Pokemon / One Piece / Lorcana
  topics created.
- **Cron:** single job (`jobid=3`, `jobname=sync-marketing-contacts`,
  `active=true`), Vault-lookup command intact, no secret
  literal, final cadence `*/5 * * * *`.
- **Sync failures:** 0.
- **CN-D2:** not started.

## Original pre-implementation review (retained for history)

**Amendments folded in from 2026-09-26 review:**

1. **Backfill scope tightened.** Only users with an actual row
   in `collector_marketing_preferences` for `site:ygo` or
   `network` are backfilled. CN-A `collector_user_sites`
   membership never causes a Resend Contact or topic
   subscription to be created on its own. Missing preference
   stays missing preference.
2. **Worker/backfill invocation is authenticated.** New
   secret `MARKETING_SYNC_TRIGGER_SECRET` gates both cron and
   backfill invocations. Edge function rejects any request
   without a matching Bearer token. pg_cron reads the
   credential from Supabase Vault by name; the literal never
   appears in migrations, source, git, or logs.
3. **Event watermark is composite + crash-safe.** Cursor is
   `(occurred_at, event_id)` tuple, not timestamp-only.
   Query uses row-tuple comparison plus a small read-lag so
   concurrent-timestamp writes have committed before the
   worker reads them. All Resend writes complete before any
   Supabase state advances; a crash mid-batch produces zero
   data loss because the worker re-reads the same events
   next cycle and every Resend operation is idempotent.

Gates A and B are both PASS (see `plan-cn-d.md`). CN-D1 is
scoped strictly to forward sync of YGO + Network consent to
Resend. Explicitly deferred to CN-D2 or later: reverse webhook
handling, bounce / complaint / suppression processing,
Broadcast sending, MTG / Poke / One Piece / Lorcana marketing
sync, admin UI, provider abstraction.

## 1. Resend resources CN-D1 creates

Only three new Resend objects. All others in the workspace
(General segment, both Untitled drafts, verified domains,
PokePrices sending state) stay **untouched**.

| Kind | Name | Default subscription | Notes |
|---|---|---|---|
| Segment | `Collector Network Contacts` | n/a | Distinct from PokePrices' `General` segment |
| Topic | `site:ygo` | `opt_out` | Immutable per Resend — verified during Gate B docs read |
| Topic | `network` | `opt_out` | Semantically independent from any site topic |

**Not created in CN-D1** (per approval scope): `site:mtg`,
`site:pokemon`, `site:onepiece`, `site:lorcana`. Their DB
config rows are also not seeded until each site launches.
`collector_marketing_topics` supports adding them one at a
time.

## 2. Supabase secret

**One new secret** to isolate CN-D1's blast radius from CN-C's
auth-mail key.

| Secret name | Purpose | Provisioned how |
|---|---|---|
| `MARKETING_RESEND_API_KEY` | Read/write Contacts, Topics, and Segments in the shared Resend workspace. Never touches `/emails` transactional send. | `supabase secrets set MARKETING_RESEND_API_KEY=... --project-ref egidpsrkqvymvioidatc` |

**Reuse:** none. `RESEND_API_KEY` (CN-C) stays scoped to the
auth-email edge function; the CN-D1 worker never reads it. If a
Resend key ever leaks, blast radius is contained to one
concern.

**Never asked for in chat.** preflightluke generates the key in
the Resend dashboard and pipes it into `supabase secrets set`
locally.

## 3. Schema migration

Idempotent, single transaction, safe to re-run. Does NOT
touch existing CN-A/CN-B tables or the `brevo_webhook` CHECK
constraint (see §7 audit note below — CN-D1 writes no consent
events so no source enum change is needed until CN-D2).

```sql
begin;

-- Reuse the trigger helper from CN-A.
-- (collector_touch_updated_at() already exists.)

-- ─────────────────────────────────────────────────────────────
-- 1. Config singleton — holds the Resend segment UUID.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_config (
  id                text primary key check (id = 'primary'),
  resend_segment_id text not null,
  updated_at        timestamptz not null default now()
);

drop trigger if exists collector_marketing_config_touch on collector_marketing_config;
create trigger collector_marketing_config_touch
  before update on collector_marketing_config
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_config enable row level security;
-- No policies: writes only via service-role edge function.

-- ─────────────────────────────────────────────────────────────
-- 2. Topic mapping — one row per (scope, site_code).
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_topics (
  scope                 text not null check (scope in ('site','network')),
  site_code             text references collector_sites(code),
  resend_topic_id       text not null,
  active                boolean not null default true,
  default_subscription  text not null default 'opt_out'
                        check (default_subscription in ('opt_in','opt_out')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check ((scope = 'site' and site_code is not null)
      or (scope = 'network' and site_code is null))
);

create unique index if not exists collector_marketing_topics_scope_site
  on collector_marketing_topics (scope, coalesce(site_code, ''));

drop trigger if exists collector_marketing_topics_touch on collector_marketing_topics;
create trigger collector_marketing_topics_touch
  before update on collector_marketing_topics
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_topics enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 3. Stable Resend contact mapping.
--    user_id ↔ resend_contact_id. Survives email changes.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_contacts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  resend_contact_id  text not null unique,
  synced_email       text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_synced_at     timestamptz not null default now(),
  last_sync_status   text not null default 'ok'
                     check (last_sync_status in ('ok','error'))
);

create index if not exists collector_marketing_contacts_synced_email_idx
  on collector_marketing_contacts (synced_email);

drop trigger if exists collector_marketing_contacts_touch on collector_marketing_contacts;
create trigger collector_marketing_contacts_touch
  before update on collector_marketing_contacts
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_contacts enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 4. Watermark singleton.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_sync_state (
  id            text primary key check (id = 'primary'),
  last_event_id uuid,
  last_run_at   timestamptz,
  last_error    text,
  updated_at    timestamptz not null default now()
);

insert into collector_marketing_sync_state (id) values ('primary')
  on conflict (id) do nothing;

drop trigger if exists collector_marketing_sync_state_touch on collector_marketing_sync_state;
create trigger collector_marketing_sync_state_touch
  before update on collector_marketing_sync_state
  for each row execute function collector_touch_updated_at();

alter table collector_marketing_sync_state enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 5. Per-user retry state — decoupled from the event feed.
-- ─────────────────────────────────────────────────────────────
create table if not exists collector_marketing_sync_failures (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  attempts        integer not null default 1,
  last_error      text not null,
  last_attempt_at timestamptz not null default now(),
  next_retry_at   timestamptz
);

alter table collector_marketing_sync_failures enable row level security;

commit;
```

**Post-migration seed** (executed only after the Segment +
Topics exist in Resend and their UUIDs are known):

```sql
begin;

insert into collector_marketing_config (id, resend_segment_id)
values ('primary', '<SEGMENT-ID-FROM-RESEND-DASHBOARD>');

insert into collector_marketing_topics
  (scope,    site_code, resend_topic_id,       active, default_subscription)
values
  ('site',   'ygo',     '<YGO-TOPIC-ID>',      true,   'opt_out'),
  ('network', null,     '<NETWORK-TOPIC-ID>',  true,   'opt_out');

commit;
```

## 4. Where things live in the repo

| File | Purpose |
|---|---|
| `supabase/migrations/2026-09-26_cn-d1_marketing_sync_schema.sql` | The migration above. |
| `supabase/functions/sync-marketing-contacts/index.ts` | Deno entry. Pulls env, invokes the pure sync-worker library, returns 204 on success / 5xx otherwise. |
| `supabase/functions/sync-marketing-contacts/deno.json` | Mirror of `auth-email/deno.json`. |
| `supabase/functions/_shared/resend-contacts.ts` | Resend REST transport: `createContact`, `patchContactTopics`, `getContactTopics`, `deleteContact`. Injectable fetch for tests. |
| `supabase/functions/_shared/sync-worker.ts` | Pure reconciliation logic: read events / group by user / compute diff / issue smallest PATCH. Fully unit-testable under Node + tsx. |
| `supabase/functions/_shared/sync-worker.test.ts` | Node `--test` suite. |
| `supabase/functions/_shared/resend-contacts.test.ts` | Node `--test` suite. |
| `supabase/config.toml` | Add `[functions.sync-marketing-contacts] verify_jwt = false` — the pg_cron hitter uses a service-role Bearer instead of a JWT. |

All new supabase edge function files use explicit `.ts`
extensions on relative imports (Deno bundler requirement —
[[feedback-deno-ts-extensions]]).

## 5. Reconciliation algorithm

```
reconcile(env, doFetch):
  segmentId := select resend_segment_id from collector_marketing_config where id='primary'
  cursor    := select last_event_id from collector_marketing_sync_state where id='primary'

  -- New events since last cycle
  newEvents := select distinct user_id from collector_marketing_consent_events
               where (cursor is null or id > cursor)
               order by occurred_at asc
               limit BATCH_SIZE
  newestEventId := max(id) of the batch

  -- Users due for retry (independent of the event stream)
  retryUsers := select user_id from collector_marketing_sync_failures
                where next_retry_at <= now()
                limit BATCH_SIZE

  usersToSync := unique(newEvents ∪ retryUsers)

  activeTopics := select * from collector_marketing_topics where active = true
  succeeded    := []
  failed       := []

  for user_id in usersToSync:
    try:
      syncOneUser(user_id, activeTopics, segmentId, env, doFetch)
      succeeded.push(user_id)
    catch (err):
      failed.push({user_id, err})

  -- Advance watermark unconditionally past this batch.
  -- Failed users get retried via the failures table, not the
  -- event stream (avoids double-processing when new events
  -- arrive for the same user).
  if newestEventId is not null:
    update collector_marketing_sync_state
      set last_event_id = newestEventId,
          last_run_at   = now(),
          last_error    = null
      where id = 'primary'
  else:
    update collector_marketing_sync_state
      set last_run_at = now() where id = 'primary'

  for u in succeeded:
    delete from collector_marketing_sync_failures where user_id = u
  for f in failed:
    upsert collector_marketing_sync_failures
      set attempts = coalesce(attempts, 0) + 1,
          last_error = tagOnly(f.err),  -- no PII, no tokens
          last_attempt_at = now(),
          next_retry_at   = now() + backoff(attempts)


syncOneUser(user_id, activeTopics, segmentId, env, doFetch):
  -- 1. Read Supabase truth.
  email := select email from auth.users where id = user_id
  if email is null: return  -- user deleted; mapping cascades

  prefs := select scope, site_code, email_opt_in
           from collector_marketing_preferences
           where user_id = user_id

  -- 2. Compute target subscription only for topics the user has
  --    expressed an opinion on. No preference row = do not PATCH
  --    that topic. Absence != opt_out.
  target := {}
  for topic in activeTopics:
    pref := prefs.find(scope = topic.scope
                    AND site_code IS NOT DISTINCT FROM topic.site_code)
    if pref exists:
      target[topic.resend_topic_id] :=
        pref.email_opt_in ? 'opt_in' : 'opt_out'

  if target is empty:
    -- No preferences on any active topic — nothing to sync.
    return

  -- 3. Mapping row + create-if-missing.
  mapping := select * from collector_marketing_contacts where user_id = user_id
  if mapping is null:
    resp := POST /contacts {
      email: normalise(email),
      segments: [segmentId],
      topics: [ {id, subscription} for each entry in target ]
    }
    insert collector_marketing_contacts (user_id, resend_contact_id, synced_email)
      values (user_id, resp.id, normalise(email))
    return

  -- 4. Email drift.
  if mapping.synced_email != normalise(email):
    PATCH /contacts/{mapping.resend_contact_id} {
      email: normalise(email),
      segments: [segmentId]
    }
    -- 404 falls through to recreate path below.
    if 200: update collector_marketing_contacts
              set synced_email = normalise(email),
                  last_synced_at = now() where user_id = user_id

  -- 5. Read current Resend topic state.
  currentResp := GET /contacts/{mapping.resend_contact_id}/topics
  if 404: goto recreate(user_id)
  current := {row.id → row.subscription for row in currentResp.data}

  -- 6. Compute smallest corrective diff (Gate B: PATCH is additive).
  diff := [ {id, subscription: target[id]}
            for id in target
            if current[id] != target[id] ]

  if diff not empty:
    PATCH /contacts/{mapping.resend_contact_id}/topics = diff

  -- 7. Success bookkeeping.
  update collector_marketing_contacts
    set last_synced_at = now(), last_sync_status = 'ok'
    where user_id = user_id
```

Key invariants:

- **Source of truth = Supabase.** Every cycle reads
  `collector_marketing_preferences` afresh; never blindly
  replays events.
- **Additive PATCH.** Uses the Gate B finding to send only
  differing topics.
- **No fabrication.** Missing preference row = topic left
  alone; absence is not opt_out.
- **`unsubscribed` never touched** by forward sync. That field
  is reserved for reverse-sync deliverability signals (CN-D2).
- **Idempotent.** Re-running the worker on the same watermark
  produces zero writes when Supabase and Resend already agree.
- **Backoff.** `backoff(n) = min(60s * 2^(n-1), 3600s)` capped
  at 1 hour. On 429 we honour Resend's `Retry-After` header if
  present.
- **No PII in error tags.** `last_error` stores status codes
  and short tags (`resend-429`, `network:TypeError`), never
  the recipient email or Resend response body.

## 6. Backfill (one-time)

Same worker, `?backfill=1` query flag on the invocation:

1. Ignore `sync_state.last_event_id`.
2. Iterate every `user_id` that has at least one row in
   `collector_marketing_preferences`.
3. Sync each. Idempotent.
4. Do **not** update `sync_state.last_event_id` — the normal
   cron cycle takes it from wherever it was.

Invoked once, manually, by preflightluke after Segment +
Topics + config seed are in place. Backfill scope at CN-D1
launch: whoever has a preference row for YGO or Network
(currently a very small set — the 4 CN-A backfilled users plus
whoever has opted in since).

## 7. Consent-source CHECK audit (§7 of the spec)

`collector_marketing_preferences.consent_source` currently
accepts `('signup','settings','preference_center','admin',
'migration','brevo_webhook')`. CN-D1 writes NO consent events
(Supabase is source of truth; the worker only READS consent
tables). Therefore:

- **No CHECK change in CN-D1.**
- `brevo_webhook` remains as inert-but-valid — no live rows
  carry it, but the migration is a no-op regression to add it
  and would touch history unnecessarily.
- CN-D2 (reverse webhook) will need `resend_webhook` added.
  The smallest backwards-safe change at that time is:
  `alter table … drop constraint …; alter table … add constraint … check (source in ('signup','settings','preference_center','admin','migration','resend_webhook'))`
  gated on a pre-migration `select count(*) where source='brevo_webhook'` returning 0.

Recording the plan; not applying now.

## 8. Scheduling

Two knobs:

- pg_cron schedule = **`* * * * *`** (every minute) during
  rollout.
- Post-validation move to **`*/5 * * * *`** (every 5 minutes)
  via a one-line `cron.alter_job(...)` call.

Both invocations use `pg_net.http_post` targeting the edge
function's Supabase URL with a service-role Bearer. Never in a
consent RPC transaction — decouples user latency from Resend.

## 9. Deployment steps (exact order)

```powershell
# 0. Confirm project ref.
supabase projects list
# Expected: egidpsrkqvymvioidatc

# 1. Apply the migration.
supabase db push --project-ref egidpsrkqvymvioidatc

# 2. Create resources in the Resend dashboard (manual):
#    a. Segments -> New segment: "Collector Network Contacts"
#       Copy the id.
#    b. Topics -> New topic:
#         name = site:ygo,   default_subscription = opt_out, visibility = private
#         name = network,    default_subscription = opt_out, visibility = private
#       Copy each id.

# 3. Seed the config rows.
# Paste the three ids into the post-migration seed SQL in §3
# and run it against the same project.

# 4. Provision the new secret.
supabase secrets set MARKETING_RESEND_API_KEY=re_******** `
  --project-ref egidpsrkqvymvioidatc

# 5. Deploy the edge function.
supabase functions deploy sync-marketing-contacts `
  --project-ref egidpsrkqvymvioidatc `
  --no-verify-jwt

# 6. One-time backfill invocation (manual):
curl.exe -sS -X POST "https://egidpsrkqvymvioidatc.supabase.co/functions/v1/sync-marketing-contacts?backfill=1" `
  -H "Authorization: Bearer $env:SUPABASE_SERVICE_ROLE_KEY"

# 7. Verify in Resend dashboard: Collector Network Contacts
#    segment has the expected number of contacts, each with
#    the correct site:ygo / network topic subscriptions.

# 8. Install the pg_cron schedule.
# (Run in the Supabase SQL editor.)
select cron.schedule(
  'sync-marketing-contacts',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://egidpsrkqvymvioidatc.supabase.co/functions/v1/sync-marketing-contacts',
       headers := jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
         'Content-Type',  'application/json'
       ),
       body := '{}'
     ); $$
);

# 9. STOP for live smoke test:
#    a. Toggle a user's YGO opt-in via /email-preferences.
#    b. Wait ~1 minute.
#    c. Confirm the contact's topics update in Resend.
#    d. Toggle again to opt-out; confirm.
#    e. Trigger Secure Email Change for that user; confirm the
#       Resend contact keeps its id and its email flips.
```

Every command carries `--project-ref egidpsrkqvymvioidatc`
explicitly. No cross-project mistakes.

## 10. Tests

**Node `--test` suites, mock fetch throughout, no live Resend
credits burned.** All wired into `apps/yugioh/package.json`
`test` script (same pattern as CN-C's shared test files).

`resend-contacts.test.ts`:

- `POST /contacts` — endpoint, Bearer auth, body shape (email +
  segments + topics), returns id.
- `GET /contacts/{id}/topics` — endpoint, response parsed
  correctly.
- `PATCH /contacts/{id}/topics` — endpoint, body is a bare
  array (not wrapped).
- `PATCH /contacts/{id}` (email drift) — endpoint, body
  omits topics field.
- 429 → `resend-429` errorTag; response body not surfaced.
- 5xx → `resend-<status>` errorTag; response body not surfaced.
- Network error → `network:<name>` errorTag.
- Missing API key → `missing-api-key`; no fetch call.

`sync-worker.test.ts` (all mock fetch, mock Supabase adapter):

- **Empty batch** → no Resend calls; watermark only updates
  `last_run_at`.
- **First-time user + one opt-in event** → POST /contacts;
  mapping row inserted; topics array in body matches target.
- **Returning user + opt-in flip** → PATCH
  `/contacts/{id}/topics` with **only the differing topic**.
- **Returning user + no change** (`current == target`) → **no
  PATCH sent**. Idempotency proof.
- **No preference row** for an active topic → topic **absent
  from PATCH body**. Absence is not opt_out.
- **Opt-out** → PATCH `{id, subscription: 'opt_out'}`.
- **Email drift** → `PATCH /contacts/{id}` body includes
  `email`; mapping's `synced_email` updated; topics PATCH runs
  separately.
- **PATCH 404** on topics/email → fallback POST; mapping
  updated with new id.
- **Resend 429** → user goes into `sync_failures` with
  `attempts=1`; other users in the batch still processed;
  watermark advances.
- **Resend 5xx** → same.
- **Retry from `sync_failures`** with `next_retry_at <= now()`
  → user re-processed; on success, failure row deleted.
- **Backfill mode** (`backfill=1`) → iterates every user with
  a preference row; ignores watermark.
- **No PII in error tags** — assert `last_error` never contains
  `@` or the raw email.
- **`unsubscribed` field never in any PATCH body** —
  invariant test.
- **Multi-user batch** — 3 users, 1 succeeds, 1 429, 1 no-op;
  correct routing to succeeded / failed / no-write.

Migration tests (`sql-driven`, run in CI against a scratch
Postgres):

- Migration is idempotent (run twice, no error).
- `collector_marketing_topics` CHECK rejects scope='site' with
  null site_code.
- `default_subscription` CHECK rejects unknown values.
- `collector_marketing_contacts.resend_contact_id` is UNIQUE.
- RLS enabled with zero policies.
- Watermark row seeded exactly once.

**Regression:** all existing CN-A / CN-B / CN-C test suites
must still pass. The full yugioh test script currently runs
260 tests. CN-D1 tests should add ~30 → target ~290.

## 11. What CN-D1 explicitly does NOT do

Per the approved scope:

- No CN-D2 reverse webhook handler.
- No `email.bounced` / `email.complained` / `suppression.*`
  processing. Deliverability tables from the plan doc
  (`collector_email_delivery_state`, `_delivery_events`) are
  **NOT created** in CN-D1 — they land with CN-D2 to keep the
  DELTA visible per slice.
- No Broadcast creation or sending.
- No newsletter campaign UI.
- No admin marketing OS.
- No MTG / Pokemon / One Piece / Lorcana marketing topics or
  sync (their `collector_marketing_topics` rows are not seeded;
  when each site launches, one INSERT + one topic-create in
  Resend enables them).
- No generic email-provider abstraction. Direct Resend REST
  calls (mirrors CN-C's transport pattern).
- No CN-A CHECK-constraint mutation (no `resend_webhook`
  source added yet — deferred to CN-D2 with pre-migration
  assertion).

## Approval requested

Please confirm each of the following matches intent, or request
changes:

1. Segment name: **`Collector Network Contacts`**.
2. Topic names + default_subscription: **`site:ygo` opt_out**,
   **`network` opt_out**.
3. New secret: **`MARKETING_RESEND_API_KEY`** (separate from
   CN-C's `RESEND_API_KEY`).
4. Schema migration in §3 is complete + safe.
5. Reconciliation algorithm in §5 is correct.
6. Backfill approach in §6 is acceptable.
7. Deferring the `resend_webhook` source to CN-D2 (§7).
8. Scheduling: 1 min rollout → 5 min steady (§8).
9. Deployment order in §9.
10. Test coverage in §10 is adequate.

Once you confirm (or amend), I implement in this order:

1. Migration SQL file + migration test.
2. Shared modules (`resend-contacts.ts` + `sync-worker.ts`)
   with unit tests. Node `--test` clean before touching
   anything else.
3. Deno entry (`sync-marketing-contacts/index.ts`) + config.
4. Wire tests into `apps/yugioh/package.json`. Full suite
   green.
5. `typecheck` + `build` clean.
6. Commit + push (Vercel-safe: YGO app unchanged).
7. **STOP** for you to run steps §9.1-9.7 in order, then
   confirm before enabling the pg_cron (§9.8).
