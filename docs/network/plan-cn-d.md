# CN-D architecture + slice plan (proposal)

Status: **PROPOSAL** — architecture only. Not started. Awaiting
CN-C closure and preflightluke's sign-off on this plan.

**v2 — 2026-09-26.** Rewritten after a live check against the
current Resend REST API. The v1 audience-per-scope model is
obsolete: Audiences are deprecated → Segments, and the correct
per-scope-consent primitive is a per-contact **Topics** array,
not one Segment per scope. Verified endpoints, semantics, and
webhook event names are recorded in the "Resend API
verification" section below and drive every downstream decision.

## Resend API verification (2026-09-26)

Fetched from https://resend.com/docs at the timestamp above.
All numbers / endpoint strings / event names in this doc are
grounded in these findings, not in prior recall.

### Model

- **Audiences are deprecated.** The Create Audience page states:
  *"Audiences are deprecated in favor of Segments. These
  endpoints will be removed in the future."* CN-D targets
  **Segments** from day one.
- **Segments** are named contact containers. Create with
  `POST https://api.resend.com/segments` with `{ name }`;
  response returns `{ object: 'segment', id, name }`.
- **Contacts** are top-level, NOT nested under an audience.
  - `POST https://api.resend.com/contacts` — create.
  - `PATCH https://api.resend.com/contacts/{id}` — update
    (also accepts `/contacts/{email}` per docs).
  - `GET https://api.resend.com/contacts` — list, returns
    `{ object, has_more, data: [...] }`. Unsubscribed contacts
    ARE returned (they carry `unsubscribed: true` on the row).
  - Contact record fields: `id`, `email`, `first_name`,
    `last_name`, `created_at`, `unsubscribed`, plus (writable
    via create/update) `segments`, `topics`, `properties`.
- **`unsubscribed` is a GLOBAL master switch on the contact**:
  *"If set to true, the contact will be unsubscribed from all
  Broadcasts."* Not per-list. Bidirectional: sending
  `{ unsubscribed: false }` on PATCH flips a previously
  unsubscribed contact back to subscribed cleanly (no
  duplicate).
- **Topics** are the per-scope primitive. From the Topics docs:
  *"Contacts can unsubscribe from certain topics while
  remaining subscribed to others through the unsubscribe
  preference page."* Topic subscription is written into the
  contact's `topics` array as
  `[{ id: <topic-id>, subscription: 'opt_in' | 'opt_out' }, …]`
  and lives on the contact record itself. Topic API exists
  under `/topics` (create / get / list / update / delete).
- **Broadcasts** target `segment_id` with an optional
  `topic_id` filter (`POST https://api.resend.com/broadcasts`).
  The docs note: *"Audiences are now called Segments."*
  Only contacts in the segment whose per-topic subscription is
  `opt_in` (and whose global `unsubscribed=false`) receive a
  broadcast filtered by topic.

### Webhook events

Complete list from the current Resend event-types page:

- Email: `email.sent`, `email.scheduled`, `email.delivered`,
  `email.delivery_delayed`, `email.bounced`, `email.complained`,
  `email.opened`, `email.clicked`, `email.failed`,
  `email.received`, `email.suppressed`.
- Contact: `contact.created`, `contact.updated`,
  `contact.deleted`.
- Suppression: `suppression.added`, `suppression.removed`.
- Domain: `domain.created`, `domain.updated`, `domain.deleted`.

Payload of `email.bounced` carries a `bounce` object with
`type` (`"Permanent"` | `"Temporary"`) and `subType`, plus
`email_id`, `broadcast_id`, `from`, `to`, `subject`, `tags`.
**Bounces are recipient-scoped, NOT list-scoped** — no
`segment_id` / `topic_id` field is emitted, because a hard
bounce means the address is bad globally. Resend's own
suppression list catches this account-wide (fires
`suppression.added`).

### What this means for CN-D

1. **One Resend segment for the whole Collector Network**:
   `Collector Network Subscribers`. Every user with any
   opt-in is a contact in this segment.
2. **Six Resend topics** — the per-scope primitive:
   - `site:ygo`, `site:mtg`, `site:pokemon`, `site:onepiece`,
     `site:lorcana`, `network`.
3. **Per-user consent** is written into the contact's
   `topics` array. `subscription='opt_in'` if the matching
   `collector_marketing_preferences` row has
   `email_opt_in=true`, `opt_out` otherwise. Contacts that
   have no opt-ins at all are optionally still present with
   every topic set to `opt_out` (or absent — see CN-D1 note
   on whether to include zero-consent users).
4. **Global `unsubscribed`** is written only from
   `suppression.added` / global unsubscribe webhooks — never
   from a per-scope opt-out. This preserves your requirement
   that site and network consent are semantically
   independent.
5. **Reverse-sync webhook handlers:**
   - `contact.updated` — inspect the delta. If a topic
     subscription flipped, mirror it to
     `collector_marketing_preferences` for that scope. If
     `unsubscribed` flipped to true, mirror as opt-out on
     EVERY scope the user currently has recorded.
   - `email.bounced` with `bounce.type='Permanent'` → treat
     as a global opt-out (mirror across all scopes). Soft
     bounces ignored on first offence.
   - `email.complained` → global opt-out.
   - `suppression.added` → global opt-out.
   - `contact.deleted` → global opt-out (defensive).
6. **Send-time filtering** (CN-E territory, out of CN-D
   scope): a newsletter broadcast for YGO is
   `POST /broadcasts` with `segment_id=<CN Subscribers>` +
   `topic_id=<site:ygo>`. Resend does the filtering; CN-D
   just keeps state accurate.

### API elements that DID need updating from v1

| v1 assumption (obsolete) | v2 reality (verified) |
|---|---|
| POST `/audiences/:id/contacts` | POST `/contacts` (top-level; segment via body) |
| One audience per scope (6 audiences) | One segment + six topics |
| Per-audience unsubscribe | Global `unsubscribed` OR per-topic subscription |
| Unsubscribe scope = one audience | Global (all broadcasts) OR per-topic |
| Webhook: `email.bounced` scoped to audience | Recipient-global. Fires `suppression.added` too |
| Backfill target = five audiences | Backfill target = one segment + six topics |

CN-D wires the existing Supabase consent state (CN-A tables +
CN-B snapshot / RPCs) into Resend Contacts so a future newsletter
sender can address only users who have opted in — per site, per
network scope. Newsletter sending itself (drafting, campaign
tooling, engagement metrics) is **not** CN-D. That is CN-E or
later.

## Goal

Keep Resend audiences in agreement with `collector_marketing_preferences`
in both directions:

- Forward: Supabase consent change → Resend audience add/remove.
- Reverse: Resend unsubscribe / bounce / complaint webhook →
  Supabase preference opt-out (with source =
  `resend_webhook`).

## Non-goals

- **No newsletter sending.** No campaign UI, no template editor,
  no analytics ingestion. CN-D leaves Resend audiences in the
  right shape and stops.
- **No new consent UX.** Signup checkboxes, Settings, and
  Preference Centre already write `collector_marketing_preferences`
  via CN-A/CN-B RPCs. CN-D is a plumbing slice, not a UI slice.
- **No admin panel.** Ops visibility for the sync is via
  Supabase Edge Function logs and a small `collector_marketing_sync_state`
  read view. A proper admin surface is a later slice.
- **No cross-provider abstraction.** Direct Resend transport. If
  we ever swap providers we do it as a targeted swap slice, the
  same shape as CN-C's Brevo → Resend swap.

## Source of truth (unchanged)

CN-A already gives us exactly what a marketing sync needs:

| Table | Purpose | CN-D role |
|---|---|---|
| `collector_marketing_preferences` | current state per (user, scope, site_code) | primary read source when reconciling one user |
| `collector_marketing_consent_events` | append-only history | change feed — CN-D watermark advances through this |
| `collector_sites` | 5-site registry + `active` flag | audience mapping key |
| `auth.users` | recipient email | joined by user_id |

Every user-facing opt-in/out path (signup / settings /
preference_center) already writes both tables atomically inside
one RPC. CN-D adds one more valid source (`resend_webhook`) and
uses the same atomic-write pattern from a webhook-driven RPC.

## Resend Contacts data model (v2)

One **segment** + six **topics**, per the API verification above.

**Segment** (created once, at CN-D1 rollout):

- `Collector Network Subscribers` — the master mailing list.
  Every user with at least one opt-in is a contact in this
  segment. Its `id` (a Resend UUID) is written into a small
  singleton config table.

**Topics** (one per scope; created once, at CN-D1 rollout — the
opt_in topics for `mtg`/`pokemon`/`onepiece`/`lorcana` exist
from day one even though those sites aren't launched, so a
returning user's future opt-in doesn't require a mid-flight
topic create):

| scope | site_code | topic name (dashboard) |
|---|---|---|
| site | `ygo` | `site:ygo` |
| site | `mtg` | `site:mtg` |
| site | `pokemon` | `site:pokemon` |
| site | `onepiece` | `site:onepiece` |
| site | `lorcana` | `site:lorcana` |
| network | — | `network` |

Mapping lives in a small config table so topic + segment UUIDs
are DB-owned, not baked into function code:

```sql
create table collector_marketing_topics (
  scope        text not null check (scope in ('site','network')),
  site_code    text references collector_sites(code),
  resend_topic_id text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((scope = 'site' and site_code is not null)
      or (scope = 'network' and site_code is null))
);
create unique index collector_marketing_topics_scope_site
  on collector_marketing_topics (scope, coalesce(site_code, ''));

create table collector_marketing_config (
  id                        text primary key check (id = 'primary'),
  resend_segment_id         text not null,
  updated_at                timestamptz not null default now()
);
```

Rows are inserted by preflightluke after creating the segment
and topics in the Resend dashboard. Setting `active=false` on a
topic row freezes sync for that scope without a schema change.

### Contact write pattern

For each affected user in a sync cycle, CN-D issues **one**
Resend call — either create or update — that sets every
relevant field atomically:

```
PATCH https://api.resend.com/contacts/{email}
Authorization: Bearer <RESEND_API_KEY>
{
  "email": "<user email>",
  "segments": ["<CN Subscribers segment id>"],
  "topics": [
    { "id": "<site:ygo topic id>",     "subscription": "opt_in" },
    { "id": "<site:mtg topic id>",     "subscription": "opt_out" },
    ...
    { "id": "<network topic id>",      "subscription": "opt_in" }
  ]
  // unsubscribed is intentionally NOT written here — reserved
  // for suppression / global-unsubscribe webhook responses so
  // per-scope opt-outs stay semantically independent.
}
```

Contact-not-found on PATCH falls through to
`POST /contacts` with the same body. Either way, one round-trip
per user per sync cycle.

## Change feed + reconciliation strategy

**Do not** trigger a Resend HTTP call from inside the user's
consent RPCs. Coupling opt-out latency to Resend availability is
a bad trade. Also: rebuilding state from events is more forgiving
than emitting one API call per event and hoping it lands.

Instead:

1. A small watermark table tracks the last consent event id we
   have synced.
2. A Supabase pg_cron job (every ~1 min) invokes an Edge Function
   `sync-marketing-contacts`.
3. The function reads consent events since the watermark, groups
   them by (user_id, scope, site_code), and for each affected
   group does a full read of the CURRENT preference row + the
   user's email + the mapped audience.
4. For each (user × audience), it computes the target state
   (opted-in ↔ present in audience) and issues the smallest
   corrective Resend call:
   - Not-in-audience → opt-in: POST audience contact (create).
   - In-audience → opt-out: PATCH `unsubscribed=true` (soft
     remove, so future opt-in re-uses the same contact record).
     We do NOT DELETE contacts — Resend keeps deliverability
     scoring on the contact and DELETE loses it.
   - Already in the target state: no-op.
5. Watermark advances only after every affected group has been
   reconciled OK.

Advantages:

- **Idempotent.** Re-running the same batch is a no-op if state
  agrees.
- **Self-healing.** Any prior missed event is caught on the next
  cycle because we compute from current state, not by replaying
  history.
- **Latency-bounded.** ~1 minute p99 lag; acceptable for an
  opt-out.
- **No user-facing failure surface.** Consent RPC latency is
  unchanged.

Watermark table (dead simple):

```sql
create table collector_marketing_sync_state (
  id           text primary key check (id = 'primary'),
  last_event_id uuid,
  last_run_at  timestamptz,
  last_error   text
);
insert into collector_marketing_sync_state (id) values ('primary')
  on conflict (id) do nothing;
```

## Failure handling

- **Per-contact API error:** log tag, do NOT advance the
  watermark, retry next cycle. If the same user fails 5 cycles in
  a row (very rare), the run should surface it in `last_error`
  and skip that user for the batch so a bad row does not stall
  the queue. Failures per (user, audience) are tracked in a
  simple retry table so 500 errors don't turn into permanent
  divergence.
- **Whole Resend outage:** watermark simply doesn't advance;
  everything catches up on recovery.
- **Missing email (user was deleted):** treated as a no-op.
  Consent tables are on `on delete cascade` from `auth.users` so
  the row disappears before we sync.

## Reverse sync: Resend → Supabase

CN-D2 ships an Edge Function `resend-webhook`. Immediate
processing (no queueing) per the "reverse should be immediate"
directive.

1. Standard Webhooks (same scheme Resend uses on the outbound
   side — reuse `verify-webhook.ts` from CN-C verbatim).
2. Parse event; route on `type`:
   - **`contact.updated`** — diff the payload against the last-
     known-state cached in our per-user retry table (or against
     what our current Supabase preferences imply). For every
     topic subscription that flipped, call
     `apply_resend_topic_change(v_user, v_scope, v_site_code, v_new_state)`.
     If `unsubscribed` also flipped to true, additionally call
     `apply_resend_global_unsubscribe(v_user)`.
   - **`email.bounced`** with `bounce.type == 'Permanent'`
     → `apply_resend_global_unsubscribe(v_user)`. Soft
     bounces (`Temporary`) ignored (no state change).
   - **`email.complained`** → `apply_resend_global_unsubscribe`.
   - **`suppression.added`** → `apply_resend_global_unsubscribe`.
   - **`contact.deleted`** → `apply_resend_global_unsubscribe`
     defensively (a contact getting deleted in Resend implies
     the recipient shouldn't be marketed to).
3. RPCs write the preference rows (`email_opt_in=false`,
   `withdrawn_at=now()`, `consent_source='resend_webhook'`) plus
   consent events atomically, mirror of
   `set_*_marketing_preference`.
   - `apply_resend_topic_change` writes one scope.
   - `apply_resend_global_unsubscribe` iterates every scope the
     user currently carries in `collector_marketing_preferences`
     and writes an opt-out on each, with one consent event per
     scope.

All webhook processing is immediate — the pg_cron forward sync
handles Supabase → Resend direction only.

Schema tweak: the CN-A consent CHECK constraint currently allows
`brevo_webhook` (dead value from the pre-swap era). CN-D
piggy-backs on that with a small migration to add
`resend_webhook`:

```sql
alter table collector_marketing_preferences
  drop constraint collector_marketing_preferences_consent_source_check;
alter table collector_marketing_preferences add constraint
  collector_marketing_preferences_consent_source_check
  check (consent_source in
    ('signup','settings','preference_center',
     'admin','migration','resend_webhook'));

-- Same for collector_marketing_consent_events.source.
```

`brevo_webhook` is dropped in the same migration since no row
carries that value (CN-A/CN-B were closed before any webhook
path was wired) — verified via `select count(*) where source =
'brevo_webhook'` before applying.

## Backfill

One-time job on CN-D1 rollout: push every current opted-in row to
its mapped Resend audience. Implemented as a specialised mode of
the sync edge function that ignores the watermark and iterates
every row of `collector_marketing_preferences where email_opt_in
= true`. Idempotent.

Expected volume: 4 users at CN-A backfill. Any opt-ins added
since then. Well below any rate limit.

## Where things live

| Concern | Location |
|---|---|
| Segment id | `collector_marketing_config.resend_segment_id` (singleton) |
| Topic mapping | `collector_marketing_topics` table (6 rows: 5 site + 1 network) |
| Watermark | `collector_marketing_sync_state` table |
| Retry state | `collector_marketing_sync_failures` table |
| Reverse-sync RPCs | `public.apply_resend_topic_change(user, scope, site, opt_in)` + `public.apply_resend_global_unsubscribe(user)` |
| Forward sync worker | `supabase/functions/sync-marketing-contacts/` |
| Webhook handler | `supabase/functions/resend-webhook/` |
| Shared: contact/segment/topic REST transport | `supabase/functions/_shared/resend-contacts.ts` |
| Shared: verify-webhook.ts | reused from CN-C verbatim |
| pg_cron trigger | `select cron.schedule(...)` calling the sync fn URL. **1 min during rollout, 5 min steady state.** |
| Env vars | `RESEND_API_KEY` reused from CN-C. `SYNC_MARKETING_HOOK_SECRET` + `RESEND_WEBHOOK_SECRET` are new. |

## Slice breakdown

Three tight slices. Each ships independently and is a STOP
checkpoint for manual verification before the next.

### CN-D1 — Schema + segment/topic config + forward sync

- **Schema migration:**
  - Create `collector_marketing_config` (singleton, holds
    `resend_segment_id`).
  - Create `collector_marketing_topics` (6 rows once
    populated: 5 site scopes + 1 network scope).
  - Create `collector_marketing_sync_state` (watermark).
  - Create `collector_marketing_sync_failures` (per-user retry
    backoff state).
  - Add `resend_webhook` and drop `brevo_webhook` in the CN-A
    consent CHECK constraints on
    `collector_marketing_preferences` and
    `collector_marketing_consent_events`. Pre-migration
    assertion: `select count(*) from ...consent_events where
    source='brevo_webhook'` returns 0.
- **Manual dashboard steps (docs/network/cn-d1-manual-setup.md):**
  1. Create the `Collector Network Subscribers` segment in
     Resend → dashboard → Segments; capture the UUID → INSERT
     `collector_marketing_config`.
  2. Create the six topics (`site:ygo`, `site:mtg`,
     `site:pokemon`, `site:onepiece`, `site:lorcana`,
     `network`) in Resend → dashboard → Topics; capture each
     UUID → INSERT six rows into `collector_marketing_topics`.
     Set `active=true` for `site:ygo` + `network`, `active=false`
     for the other four until each site launches its shared
     consent integration.
- **Edge function `sync-marketing-contacts`:**
  - Reads watermark + events since.
  - Groups by user; reads current
    `collector_marketing_preferences` rows + `auth.users.email`
    + active topic mapping for each user.
  - One PATCH per user against `/contacts/{email}` with the
    full topic subscription vector + segment membership.
    Fallback to POST `/contacts` on 404. `unsubscribed` is
    NEVER written from forward sync.
  - Advances watermark on success.
  - Rate-limit safe: batch cap + exponential backoff on 429.
- **pg_cron schedule:** `* * * * *` (1 min) during rollout;
  step down to `*/5 * * * *` once backfill is clean.
- **One-time backfill** (`BACKFILL=1` mode): iterates every
  `collector_marketing_preferences` row where
  `email_opt_in=true`, groups by user, issues the same PATCH.
  Idempotent — re-running is a no-op if state matches.
- **Tests (mock fetch, no live Resend credits):**
  - opt-in event → PATCH `/contacts/{email}` body includes
    matching topic subscription = `opt_in`.
  - opt-out event on scope X while other scopes still opt-in
    → PATCH body has `opt_out` on X, `opt_in` on others.
    `unsubscribed` field absent from body.
  - unchanged event → no Resend call.
  - Resend 429 → backoff retry; watermark not advanced.
  - Resend 5xx → same.
  - Inactive topic row (onepiece/lorcana at CN-D1 launch) →
    excluded from the topics vector for that scope.
  - Missing segment config → sync short-circuits with a
    log-friendly error, no partial writes.
  - User with all scopes opted-out → contact still PATCHed
    with an all-`opt_out` topics vector (never marks
    `unsubscribed=true`).
- **Docs:** `docs/network/cn-d1-manual-setup.md` covering
  segment + topic creation, config INSERTs, backfill run,
  smoke tests. Mirror the CN-C manual-setup structure.
- **STOP** for manual dashboard verification. Preflightluke
  confirms:
  1. Segment + topics show up in the Resend dashboard.
  2. Post-backfill contact list matches expected user
     count.
  3. Opting-in via /settings on ygoprices.io lands the
     contact with the right topics within ~1 minute.
  4. Opting-out via /settings removes the topic subscription
     within ~1 minute.

### CN-D2 — Reverse sync via Resend webhook

- Edge function `resend-webhook`:
  - Standard Webhooks signature verification via reused
    `_shared/verify-webhook.ts` (secret =
    `RESEND_WEBHOOK_SECRET`).
  - Route by `type`:
    - `contact.updated` — diff topics vs Supabase current
      state, call `apply_resend_topic_change` for each
      flipped topic. If `unsubscribed=true` in the payload,
      additionally call `apply_resend_global_unsubscribe`.
    - `email.bounced` with `bounce.type='Permanent'`,
      `email.complained`, `suppression.added`,
      `contact.deleted` → `apply_resend_global_unsubscribe`.
  - Lookup user by email (join `auth.users.email`).
    Unknown email → 204 no-op + log.
  - Lookup scope+site by topic id (join
    `collector_marketing_topics.resend_topic_id`). Unknown
    topic → 204 no-op + log.
- **RPCs (both SECURITY DEFINER, atomic preference + event
  writes, `search_path=''`):**
  - `public.apply_resend_topic_change(p_user_id uuid,
    p_scope text, p_site_code text, p_opt_in boolean)` —
    writes one preference row + one event with
    source='resend_webhook'.
  - `public.apply_resend_global_unsubscribe(p_user_id uuid)`
    — reads every existing preference row for the user,
    writes opt-out on each + one event per scope.
  - Both refuse `p_user_id` that isn't in `auth.users` (defensive;
    the webhook handler already filters).
- Configure the Resend webhook endpoint in the dashboard —
  subscribe to `contact.*`, `email.bounced`, `email.complained`,
  `suppression.added`.
- **Tests:**
  - signature rejection (missing / stale / tampered).
  - `contact.updated` with one topic flipped opt_in→opt_out →
    one preference row updated + one event with
    source='resend_webhook'. Other scopes untouched.
  - `contact.updated` with `unsubscribed=true` → opt-out on
    every scope the user currently carries; one event per
    scope.
  - `email.bounced` Permanent → global opt-out.
  - `email.bounced` Temporary → 204 no-op (no state change).
  - `email.complained` → global opt-out.
  - `suppression.added` → global opt-out.
  - `contact.deleted` → global opt-out (defensive).
  - unknown email → 204 no-op + log.
  - unknown topic_id in a `contact.updated` payload → skipped,
    other topics processed, log emitted.
  - no tokens/emails/api-keys leaked in log summaries (CN-C
    invariant preserved).
- **STOP** for manual verification: trigger an unsubscribe
  from the Resend preference page for the test recipient →
  Supabase preference row for that scope flips within ~2s,
  event row appears with source='resend_webhook',
  `collector_marketing_consent_events.occurred_at` matches
  event delivery.

### CN-D3 — Ops surface + drift detection

- Read view `collector_marketing_sync_status` exposing
  `last_event_id`, `last_run_at`, `last_error`, failure count.
- Periodic (daily) drift check job: pick a small sample of
  opted-in users, verify their presence in the mapped Resend
  audience, log discrepancies.
- Alerting hooks (log-based; no PagerDuty integration in this
  slice).
- Docs: closure doc for CN-D + one-page runbook for a common
  drift scenario ("user reports still receiving newsletter
  after opting out").

CN-D closes when CN-D3 is applied and 7 days of clean sync logs
have accumulated.

## Explicit dependencies on prior slices

- CN-A tables and RPCs (unchanged in CN-D).
- CN-B snapshot + signup consent RPC (unchanged).
- CN-C Resend account, verified sender, `RESEND_API_KEY`
  (reused; CN-D uses the SAME key — one Resend account, one
  key, both transactional and audience calls).
- CN-C `verify-webhook.ts` (imported by the CN-D reverse-sync
  webhook function).

## What could bite us

- **Topics are a first-class contact field.** Every PATCH we
  send has to include the FULL topics vector, not a delta —
  otherwise omitted topics may be left as whatever they were
  previously. CN-D1 tests must cover this: after writing
  `{topics: [ygo=opt_in]}` then `{topics: [network=opt_in]}`,
  the second write MUST leave ygo=opt_in intact. **Verify at
  CN-D1**: is Resend's PATCH additive or replace-all on
  `topics`? The docs are ambiguous on the point. If Resend
  replaces, this is fine as long as we send the full vector.
  If Resend merges, sync becomes cheaper. Either way, we send
  the full vector defensively.
- **Global `unsubscribed` blocks broadcasts, not transactional.**
  Confirm at CN-D1 that a contact with `unsubscribed=true`
  still receives CN-C auth email (which uses the transactional
  send path). Resend docs describe `unsubscribed` in terms of
  "all Broadcasts," implying transactional is unaffected, but
  worth a live check with a suppressed test address before
  we trust it.
- **Suppression list is account-global.** A hard bounce on any
  send (including auth email) adds the address to the account
  suppression list, which stops ALL future sends including
  transactional auth email. This is a Resend platform behaviour
  we can't disable; the mitigation is (a) reverse-sync
  `suppression.added` fast and (b) surface a "your account
  email may be undeliverable" flag in the user's own /settings
  page (post-CN-D concern, but flag it here).
- **Email as identity.** Resend keys contacts by email. If a
  user changes their email via CN-C Secure Email Change, we
  need to update the Resend contact's email too. Supabase does
  not natively emit an `email_changed` event; CN-D1 adds a
  small `on update` trigger on `auth.users(email)` that inserts
  a synthetic row into `collector_email_changes` which the
  sync worker also drains. The sync uses
  `PATCH /contacts/{id}` with `{email: <new>}` on the existing
  contact id (fetched from a lookup), NOT create-a-new-contact,
  to avoid duplicates.
- **Rate limits.** Resend enforces per-second limits on the
  contact API. Batch size cap + exponential backoff on 429 in
  the sync function.
- **PII in logs.** Same rule as CN-C: never log the recipient
  email in full; domain-only tag for observability. No tokens
  or webhook payload bodies in logs.

## Answered questions (preflightluke, 2026-09-26)

1. **Network audience:** dedicated. Semantically independent
   from site consent. Modelled here as a stand-alone topic
   `network` on the same segment; a broadcast targeting
   `topic_id=network` only reaches contacts with
   `subscription: 'opt_in'` on that topic, exactly what a
   dedicated audience gave you in the legacy model.
2. **Backfill:** YGO + Network at CN-D1, incrementally per site
   as each shared-consent integration goes live. `active` flag
   on `collector_marketing_topics` gates whether the sync
   worker writes that topic's subscription; enabling MTG (etc.)
   later is one row update + a per-site backfill run.
3. **Cadence:** pg_cron 1 min during rollout, 5 min steady
   state. Reverse-sync webhook is immediate — no queue.
