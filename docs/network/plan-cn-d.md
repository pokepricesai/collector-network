# CN-D architecture + slice plan (proposal)

Status: **PROPOSAL v3** — architecture only. Not started.
CN-C is **closed** as of 2026-09-26. CN-D1 remains blocked on
Gate A (PokePrices Resend account audit) and Gate B
(PATCH `/contacts` topics semantics experiment) — both
recorded in the "Verification steps before implementation"
section below.

**v2 — 2026-09-26.** Rewritten after a live check against the
current Resend REST API. The v1 audience-per-scope model is
obsolete: Audiences are deprecated → Segments, and the correct
per-scope-consent primitive is a per-contact **Topics** array,
not one Segment per scope. Verified endpoints, semantics, and
webhook event names are recorded in the "Resend API
verification" section below and drive every downstream decision.

**v3 — 2026-09-26.** Three architecture corrections applied
after CN-D v2 review:

1. **Consent and deliverability are separated.** Hard bounce,
   soft bounce, complaint, and provider-side suppression are
   NOT rewritten as marketing opt-outs. They live on a new
   `collector_email_delivery_state` table. Consent history in
   `collector_marketing_preferences` /
   `collector_marketing_consent_events` remains intact even
   when an address becomes undeliverable.
2. **Stable Resend contact mapping** lives in
   `collector_marketing_contacts` — `(user_id,
   resend_contact_id, synced_email, ...)`. All Resend PATCH
   traffic keys off `resend_contact_id`, not off the current
   email string. Cleanly handles Secure Email Change; sync
   worker reads the mapping to detect email drift.
3. **PokePrices Resend audit is a gate on CN-D1.** PokePrices
   already has a live Resend integration. Before CN-D1
   creates a segment/topics/contacts we must enumerate the
   existing state and decide how to coexist (or migrate).
   Audit checklist + findings slot below.

Also from v3: the shared segment is renamed **Collector
Network Contacts** (not "Subscribers") — a retained contact may
legitimately have every topic set to opt_out, and the container
name should not imply subscription. PATCH `/contacts` topic
semantics (additive vs replace-all) must be verified
**experimentally**, not assumed, before CN-D1 code goes live.
See "Verification steps before implementation" below.

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

## Resend Contacts data model (v3)

One **segment** + six **topics**, per the API verification above.

**Segment** (created once, at CN-D1 rollout, subject to the
PokePrices audit finding a segment we should reuse instead):

- `Collector Network Contacts` — the master container. Every
  user we hold marketing state for is a contact in this
  segment, INCLUDING users whose topic subscriptions are all
  `opt_out`. The segment name is deliberately not
  "Subscribers" — a retained contact may legitimately be fully
  opted-out (we still hold the historical record and the
  Resend contact id). Its `id` (a Resend UUID) is written into
  a small singleton config table.

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
  default_subscription text not null default 'opt_out'
                        check (default_subscription in ('opt_in','opt_out')),
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

`default_subscription = 'opt_out'` at the schema layer for every
seeded topic row — enforces the "topics default to opt-out"
rule at the source of truth, not in application code. Rows are
inserted by preflightluke after creating the segment and topics
in the Resend dashboard (or after adopting existing PokePrices
segment/topics per audit findings). Setting `active=false` on a
topic row freezes sync for that scope without a schema change.

### Stable Resend contact mapping (v3)

Resend keys contacts by UUID; email is a mutable attribute of a
contact, not its identity. CN-D holds the mapping locally so
Secure Email Change and any future email edits do not require
guessing at Resend's side:

```sql
create table collector_marketing_contacts (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  resend_contact_id  text not null unique,
  synced_email       text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  last_synced_at     timestamptz not null default now(),
  last_sync_status   text not null default 'ok' check (last_sync_status in ('ok','error'))
);
create index collector_marketing_contacts_synced_email_idx
  on collector_marketing_contacts (synced_email);
```

- **First sync** creates the Resend contact (POST /contacts),
  captures the returned `id`, inserts the mapping row.
- **Every subsequent sync** issues `PATCH /contacts/{resend_contact_id}`
  — never `PATCH /contacts/{email}`. Email is just another
  field on the body.
- **Secure Email Change** flow: sync worker compares
  `auth.users.email` vs `collector_marketing_contacts.synced_email`
  for the affected user; if different, the next PATCH body
  includes the new email, and `synced_email` is updated on
  success. No separate `collector_email_changes` queue.
- **Cascade on user delete:** if `auth.users` row is deleted,
  the mapping cascades. Reverse-sync webhook still fires
  `contact.deleted` on Resend's side; handler sees no user_id
  and 204s cleanly.

## Consent vs deliverability (v3)

Two orthogonal states. Do not conflate them.

### Consent (marketing choice, immutable ledger)

Owned by CN-A/CN-B, unchanged:

- `collector_marketing_preferences` — current per-scope opt state.
- `collector_marketing_consent_events` — append-only history.
- Sources: `signup / settings / preference_center / admin /
  migration / resend_webhook`.
- **`resend_webhook` source is reserved for the narrow case
  where the user themselves changed their marketing choice on
  Resend** (unsubscribed a topic on Resend's preference page, or
  performed a first-party global-unsubscribe click). Provider-
  side deliverability failures do NOT write here.

### Deliverability (provider verdict on the address)

New table, orthogonal to consent:

```sql
create table collector_email_delivery_state (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  status        text not null check (status in
                  ('deliverable',
                   'hard_bounce',
                   'soft_bounce_watch',
                   'complaint',
                   'provider_suppressed',
                   'manual_suppressed')),
  reason        text,        -- resend subType + free-form
  source        text not null check (source in
                  ('resend_webhook','manual','sync_probe')),
  observed_at   timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Append-only history, mirrors the consent-events pattern.
create table collector_email_delivery_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null,
  reason        text,
  source        text not null,
  resend_event_id text,      -- for correlating back to a Resend webhook
  occurred_at   timestamptz not null default now()
);
create index collector_email_delivery_events_user_idx
  on collector_email_delivery_events (user_id, occurred_at desc);
```

Owner-only SELECT RLS. Write access via SECURITY DEFINER RPCs
only (mirror of the CN-A pattern).

### Broadcast eligibility

Conceptually a broadcast may address `user × topic` iff:

```
collector_marketing_preferences[user, scope].email_opt_in = true
AND collector_marketing_contacts[user].last_sync_status = 'ok'
AND (
  collector_email_delivery_state[user] is null
  OR collector_email_delivery_state[user].status = 'deliverable'
)
AND user does not carry a network-scope 'global marketing opt-out' preference row
```

That last clause covers a genuine user-initiated global
unsubscribe — see "Global unsubscribe semantics" below. The DB
does not enforce the eligibility computation because sending is
CN-E territory; CN-D's job is only to keep every input to that
computation truthful.

### Global unsubscribe semantics (design frozen before CN-D2)

Two distinct signals can flip a Resend contact's global
`unsubscribed` flag to true. We must not treat them the same:

| Trigger | Signal on webhook | Meaning | CN-D action |
|---|---|---|---|
| User clicks Resend's global-unsubscribe / preference-page unsubscribe-from-everything | `contact.updated` with `unsubscribed=true` AND the change wasn't preceded by a `suppression.added` / bounce / complaint we just observed | User-initiated marketing withdrawal | **Consent-side**: opt-out on every scope the user carries, `consent_source='resend_webhook'`. Deliverability untouched. |
| Resend auto-set `unsubscribed=true` because of `suppression.added` / hard bounce / complaint | `contact.updated` following a same-user `suppression.added` OR `email.bounced` (Permanent) OR `email.complained` within a short causal window | Provider verdict on address | **Deliverability-side**: write `collector_email_delivery_state` with the appropriate status + source. Consent untouched. |

Because the raw `contact.updated` event alone can't tell the two
apart, CN-D2 correlates via a short in-memory (or lightweight
DB) window: if a `suppression.added` / `email.bounced` /
`email.complained` for the same user fired within the last N
seconds, treat the following `contact.updated`
`unsubscribed=true` as provider-driven and route to
deliverability. Otherwise route to consent. The window and the
tie-breaker rule are the last thing designed before CN-D2 code
starts; both events end up in
`collector_email_delivery_events` OR
`collector_marketing_consent_events`, never both.

### Contact write pattern

For each affected user in a sync cycle, CN-D issues **one**
Resend call — either create or update — that sets every
relevant field atomically:

```
PATCH https://api.resend.com/contacts/{resend_contact_id}
Authorization: Bearer <RESEND_API_KEY>
{
  "email": "<user email — updated only when auth.users.email
             differs from collector_marketing_contacts.synced_email>",
  "segments": ["<Collector Network Contacts segment id>"],
  "topics": [
    { "id": "<site:ygo topic id>",     "subscription": "opt_in" },
    { "id": "<site:mtg topic id>",     "subscription": "opt_out" },
    ...
    { "id": "<network topic id>",      "subscription": "opt_in" }
  ]
  // `unsubscribed` is intentionally NOT written here — the
  // forward sync never touches this field. It is a
  // deliverability signal owned by reverse-sync + Resend's own
  // suppression logic.
}
```

**First-time users** (no `collector_marketing_contacts` row):
`POST /contacts` with the same body; on 200 capture the returned
`id` and insert the mapping row atomically. On subsequent runs
that user's PATCH keys off the stored `resend_contact_id`.

If `PATCH /contacts/{id}` returns 404 (contact deleted
externally), CN-D falls back to `POST` and reinserts the mapping
with the fresh id, logging the recreate for ops visibility.

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

## Reverse sync: Resend → Supabase (v3)

CN-D2 ships an Edge Function `resend-webhook`. Immediate
processing (no queueing) per the "reverse should be immediate"
directive. Every webhook is routed to EITHER the consent RPCs
OR the deliverability RPCs — never both. Consent history is
preserved even when an address becomes undeliverable.

1. Standard Webhooks signature verification via reused
   `_shared/verify-webhook.ts` (secret =
   `RESEND_WEBHOOK_SECRET`).
2. Lookup user by `resend_contact_id` via
   `collector_marketing_contacts`. Unknown contact → 204 no-op
   + log (contact was created outside CN-D's control; likely
   PokePrices legacy — see audit).
3. Route on `type`:

| Resend event | Route | RPC |
|---|---|---|
| `contact.updated` — per-topic subscription changed | consent | `apply_resend_topic_change(user, scope, site, opt_in)` |
| `contact.updated` — `unsubscribed=true`, NO recent bounce/complaint/suppression for this user | consent | `apply_resend_global_marketing_withdrawal(user)` |
| `contact.updated` — `unsubscribed=true`, WITHIN N sec of `suppression.added`/`email.bounced` Permanent/`email.complained` for this user | deliverability | already handled by the earlier event (below); ignore |
| `email.bounced` `bounce.type='Permanent'` | deliverability | `record_email_delivery_state(user, 'hard_bounce', bounce.subType, resend_event_id)` |
| `email.bounced` `bounce.type='Temporary'` | deliverability | `record_email_delivery_state(user, 'soft_bounce_watch', bounce.subType, resend_event_id)` — used for future retry pacing, not eligibility |
| `email.complained` | deliverability | `record_email_delivery_state(user, 'complaint', ...)` |
| `suppression.added` | deliverability | `record_email_delivery_state(user, 'provider_suppressed', ...)` |
| `suppression.removed` | deliverability | `record_email_delivery_state(user, 'deliverable', 'suppression-lifted', ...)` — restores marketing eligibility for a re-verified address |
| `contact.deleted` | consent + deliverability | (defensive) `apply_resend_global_marketing_withdrawal(user)` AND `record_email_delivery_state(user, 'manual_suppressed', 'contact-deleted', ...)` |

RPCs (all SECURITY DEFINER, atomic writes, `search_path=''`):

- `public.apply_resend_topic_change(p_user_id uuid, p_scope
  text, p_site_code text, p_opt_in boolean)` — one scope; one
  event with `consent_source='resend_webhook'`.
- `public.apply_resend_global_marketing_withdrawal(p_user_id
  uuid)` — iterates every scope the user currently carries
  and writes opt-out + event per scope. Never writes
  deliverability state.
- `public.record_email_delivery_state(p_user_id uuid,
  p_status text, p_reason text, p_resend_event_id text)` —
  upserts `collector_email_delivery_state` and appends
  `collector_email_delivery_events`. Never writes consent.

**Correlation window** for the `contact.updated` +
`suppression.added` / bounce / complaint ambiguity: CN-D2
checks `collector_email_delivery_events` for a same-user event
within the last N seconds (start with 30 s). If found, the
subsequent `unsubscribed=true` is provider-driven and the
consent-side RPC is NOT called. If not, the consent-side RPC
IS called.

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

## Where things live (v3)

| Concern | Location |
|---|---|
| Segment id | `collector_marketing_config.resend_segment_id` (singleton) |
| Topic mapping | `collector_marketing_topics` (6 rows: 5 site + 1 network, `default_subscription='opt_out'`) |
| **Contact mapping (stable Resend id ↔ user)** | `collector_marketing_contacts` |
| Watermark | `collector_marketing_sync_state` |
| Retry state | `collector_marketing_sync_failures` |
| **Deliverability state (current)** | `collector_email_delivery_state` |
| **Deliverability events (append-only)** | `collector_email_delivery_events` |
| Consent RPCs (reverse-sync) | `apply_resend_topic_change`, `apply_resend_global_marketing_withdrawal` |
| Deliverability RPC | `record_email_delivery_state` |
| Forward sync worker | `supabase/functions/sync-marketing-contacts/` |
| Webhook handler | `supabase/functions/resend-webhook/` |
| Shared REST transport | `supabase/functions/_shared/resend-contacts.ts` |
| Shared: verify-webhook.ts | reused from CN-C verbatim |
| pg_cron trigger | `cron.schedule(...)` calling the sync fn URL. **1 min during rollout, 5 min steady state.** |
| Env vars | `RESEND_API_KEY` reused from CN-C. `RESEND_WEBHOOK_SECRET` is new. |

## Verification steps before implementation (v3 gates)

Both must complete + be recorded in this doc before CN-D1
touches Resend.

### Gate A — PokePrices Resend account audit

PokePrices already has a live Resend integration. Before CN-D1
creates a segment, topics, or contacts we must enumerate what
exists and decide whether to reuse, coexist, or migrate.

**What I could verify from this repo (2026-09-26):**

- No PokePrices source code lives in `collector-network/`. The
  README states "PokePrices — remains in its own existing
  repository."
- No `RESEND_API_KEY` value or PokePrices Resend account
  reference lives in this repo (grepped for `pokeprices|POKE_RESEND|
  api.resend.com` — only CN-C references appear).
- Therefore this audit must be executed against the PokePrices
  Resend workspace directly — either by preflightluke pasting
  the findings below, or by preflightluke giving CN-D
  read-only access to a token scoped to the PokePrices Resend
  account so the sync worker's audit mode can enumerate.

**Audit commands** (run against the PokePrices Resend account
key; safe read-only calls; no writes):

```bash
# 1. Same account as CN-C auth key?
#    Compare API-key prefix + call GET /audiences / GET /segments
#    with both keys. Same account = same output set.
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     https://api.resend.com/segments
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     https://api.resend.com/audiences   # deprecated, but returns legacy state

# 2. Contacts count + first page shape
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     "https://api.resend.com/contacts?limit=10"

# 3. Existing topics
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     https://api.resend.com/topics

# 4. Broadcast history — reveals whether Resend is currently
#    used for marketing at all vs transactional only.
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     https://api.resend.com/broadcasts

# 5. Recent email activity (spot-check for transactional vs
#    marketing pattern — auth confirmation vs newsletter)
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     "https://api.resend.com/emails?limit=20"

# 6. Domains configured (verifies which sender domain the
#    PokePrices key controls — do CN + PokePrices share
#    a verified domain?)
curl -s -H "Authorization: Bearer $POKE_RESEND_KEY" \
     https://api.resend.com/domains
```

**Findings (PASS, 2026-09-26):**

| Question | Finding |
|---|---|
| Same Resend account/workspace as CN-C `RESEND_API_KEY`? | **Yes** — `/emails` contains both PokePrices sends and Collector Network / YGOPrices sends |
| Existing Audiences (legacy)? Count + names | 1 — `General`, id `d2a83a27-1b52-48d5-a57b-723ff9b26369` (legacy `/audiences` returns the same object as `/segments`) |
| Existing Segments? Count + names + ids | 1 — `General` (same id as above) |
| Existing Topics? Count + names + ids | **0** |
| Existing Contacts? Approximate count + any `unsubscribed=true` populated | **0** |
| Existing Broadcasts? Any marketing sends already historical? | 2 untargeted drafts, both named `Untitled` — preserve untouched |
| Recent Emails: transactional / marketing / both? | Transactional/lifecycle only (PokePrices) + CN-C auth email. No marketing broadcasts have shipped. |
| Verified domains? Overlap with CN-C `send.collector.network` sender? | Existing PokePrices domains + CN-C `send.collector.network` all verified in the same workspace. Preserve. |
| Any suppression list entries we must preserve? | None material — no marketing state to migrate |

**Coexistence decisions (recorded 2026-09-26):**

1. **Same account confirmed** → CN-D creates the
   `Collector Network Contacts` segment alongside PokePrices'
   `General` segment. Both live in the same workspace.
2. **Do NOT reuse or rename `General`.** CN-D creates its
   own segment. Rationale: `General` is PokePrices' legacy
   container; renaming or repurposing risks confusion during
   the incremental site rollout.
3. **Preserve everything currently in the workspace**:
   `General` segment, both `Untitled` broadcast drafts,
   existing PokePrices verified domains, and PokePrices'
   ongoing lifecycle/transactional sending behaviour.
4. **PokePrices Contacts / Topics state to migrate: none.**
   Workspace has 0 contacts and 0 topics — CN-D1 starts from
   a clean marketing-state slate.
5. **Naming discipline for CN-D-owned resources**:
   - Segment: `Collector Network Contacts`
   - Topics: `site:ygo`, `network` (CN-D1 scope). Future:
     `site:mtg`, `site:pokemon`, `site:onepiece`,
     `site:lorcana` as each launches.

**Audit status:** PASS.

### Gate B — PATCH /contacts topics semantics (experimental)

The Resend docs are ambiguous on whether
`PATCH /contacts/{id}` with `{topics: [...]}` is additive or
replace-all. CN-D's forward sync sends the full topics vector
either way, but the write-cost analysis and the reverse-sync
diff logic both depend on the answer.

**Experiment** (safe, uses a throwaway test contact against the
CN-C `RESEND_API_KEY` on the Collector Network Resend account,
provided CN + PokePrices share the account and the audit
doesn't forbid it; otherwise use a scratch account):

1. Create a test contact with `topics: [{id: T1, subscription:
   'opt_in'}, {id: T2, subscription: 'opt_in'}]`.
2. `GET /contacts/{id}` — confirm both topics returned.
3. `PATCH /contacts/{id}` with `{topics: [{id: T3,
   subscription: 'opt_in'}]}` (a third, unrelated topic; T1
   and T2 omitted from body).
4. `GET /contacts/{id}` — inspect the returned topics array.
   - If T1 and T2 are still `opt_in` → PATCH is **additive**.
   - If T1 and T2 are gone or reset → PATCH is
     **replace-all**.
5. Delete the test contact.

**Results (PASS, 2026-09-26):**

Live experiment run against the shared Resend workspace using
throwaway topics `cn-gate-b-topic-a/b/c` (all default opt_out)
and throwaway contact `cn-gate-b-throwaway@example.com`. Every
temporary resource deleted afterwards; workspace verified back
to 0 topics / 0 contacts.

| Question | Finding |
|---|---|
| PATCH `topics` behaviour | **Additive / merge** |
| Retrieval endpoint | `GET /contacts/{id}/topics` returns `data: [{id, name, description, subscription}]` — the correct observability channel (`GET /contacts/{id}` does not carry topics) |
| Update endpoint | `PATCH /contacts/{id}/topics` — dedicated sub-resource, body is a bare array of `{id, subscription}` |

**Observed timeline:**
- After creating contact with `[A opt_in, B opt_in]`, GET
  returned `A opt_in, B opt_in, C opt_out` (C's default surfaced
  even though never explicitly set on the contact).
- After `PATCH /contacts/{id}/topics [{C: opt_in}]`, GET
  returned `A opt_in, B opt_in, C opt_in`.
- **A and B were untouched by the PATCH.**

**Design consequence (folded into the reconciliation algorithm
below):**

- Forward sync sends the **smallest corrective PATCH**: only
  the topics whose target state differs from Resend's current
  observed state. Reduces API traffic and avoids sending
  no-op subscription updates.
- Supabase remains the source of truth. Reconciliation must
  still READ current Resend + Supabase truth each cycle and
  repair drift, rather than blindly replaying event history.
- No-preference-in-Supabase = **do not PATCH** that topic.
  Absence remains absence — CN-D never fabricates consent by
  writing `opt_out` to a topic the user has never expressed a
  preference on.

**Experiment status:** PASS.

## Slice breakdown

Three tight slices. Each ships independently and is a STOP
checkpoint for manual verification before the next.

### CN-D1 — Schema + segment/topic config + contact mapping + forward sync

**Gate:** Do not start CN-D1 until Gate A (PokePrices audit) and
Gate B (PATCH topics experiment) are both filled in above.

- **Schema migration:**
  - Create `collector_marketing_config` (singleton, holds
    `resend_segment_id`).
  - Create `collector_marketing_topics` (6 rows once
    populated: 5 site scopes + 1 network scope,
    `default_subscription='opt_out'`).
  - Create `collector_marketing_contacts` (stable Resend id
    mapping; user_id PK, resend_contact_id unique).
  - Create `collector_email_delivery_state` +
    `collector_email_delivery_events` (deliverability side —
    ships in CN-D1 even though writes come in CN-D2, so the
    schema is settled before webhook code exists).
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
  1. Per Gate A audit outcome: EITHER create the
     `Collector Network Contacts` segment in Resend → dashboard
     → Segments (name is not "Subscribers"; a fully opted-out
     retained contact still belongs), capture the UUID → INSERT
     `collector_marketing_config`; OR reuse the existing
     PokePrices segment id if the audit finds an appropriate
     one and preflightluke elects to reuse.
  2. Create the six topics (`site:ygo`, `site:mtg`,
     `site:pokemon`, `site:onepiece`, `site:lorcana`,
     `network`) in Resend → dashboard → Topics; capture each
     UUID → INSERT six rows into `collector_marketing_topics`.
     `active=true` for `site:ygo` + `network`, `active=false`
     for the other four until each site launches its shared
     consent integration. **PokePrices legacy topics (if any
     found in Gate A) MUST NOT be renamed or reused unless the
     audit explicitly says so.**
- **Edge function `sync-marketing-contacts`:**
  - Reads watermark + events since.
  - Groups by user; for each affected user reads:
    - current `collector_marketing_preferences` rows,
    - `auth.users.email`,
    - active topic mapping (rows where `active=true`),
    - existing `collector_marketing_contacts` row (may be
      absent → first sync for this user).
  - Computes the target `topics` vector: for each active
    topic, `subscription='opt_in'` iff the matching
    preference row has `email_opt_in=true`, else `opt_out`.
    Inactive topics (currently `site:mtg`, `site:pokemon`,
    `site:onepiece`, `site:lorcana` at CN-D1 launch) are
    omitted entirely from the vector.
  - If `collector_marketing_contacts` row exists:
    `PATCH /contacts/{resend_contact_id}` with the full
    topics vector + segment membership + (only when
    drift-detected) new email.
  - Else: `POST /contacts` with the same body; capture the
    returned `id`; insert the mapping row atomically.
  - On PATCH 404: recreate via POST and update the mapping
    (contact was deleted externally). Log the recreate.
  - `unsubscribed` field is NEVER included in the body from
    forward sync. Consent + deliverability are the only
    signals that ever flip it.
  - Advances watermark on success.
  - Rate-limit safe: batch cap + exponential backoff on 429.
- **pg_cron schedule:** `* * * * *` (1 min) during rollout;
  step down to `*/5 * * * *` once backfill is clean.
- **One-time backfill** (`BACKFILL=1` mode): iterates every
  `collector_marketing_preferences` row where
  `email_opt_in=true`, groups by user, issues the same PATCH.
  Idempotent — re-running is a no-op if state matches.
- **Tests (mock fetch, no live Resend credits):**
  - First-time user (no `collector_marketing_contacts` row)
    → POST `/contacts`, mapping row inserted with returned id.
  - Returning user → PATCH `/contacts/{resend_contact_id}`
    NOT `/contacts/{email}`.
  - opt-in event → PATCH body includes matching topic
    subscription = `opt_in`.
  - opt-out event on scope X while other scopes still opt-in
    → PATCH body has `opt_out` on X, `opt_in` on others.
    `unsubscribed` field absent from body.
  - Email drift (auth.users.email != synced_email) → PATCH
    body includes new email; on success `synced_email` is
    updated in the mapping row.
  - No drift → PATCH body omits email field.
  - PATCH returns 404 → fallback POST + mapping row upsert;
    log records `recreate=true`.
  - unchanged event → no Resend call.
  - Resend 429 → backoff retry; watermark not advanced;
    failure row appended to `collector_marketing_sync_failures`.
  - Resend 5xx → same.
  - Inactive topic row (mtg/pokemon/onepiece/lorcana at CN-D1
    launch) → excluded entirely from the topics vector.
  - Missing segment config → sync short-circuits with a
    log-friendly error, no partial writes.
  - User with all scopes opted-out → contact still PATCHed
    with an all-`opt_out` topics vector (never marks
    `unsubscribed=true`).
  - No PII (email addresses) in log summaries. Domain-only
    tags for observability.
- **Docs:** `docs/network/cn-d1-manual-setup.md` covering
  segment + topic creation, config INSERTs, backfill run,
  smoke tests. Mirror the CN-C manual-setup structure.
- **STOP** for manual dashboard verification. Preflightluke
  confirms:
  1. Segment + topics show up in the Resend dashboard (and
     any PokePrices legacy state is untouched).
  2. `collector_marketing_contacts` row count matches
     `collector_marketing_preferences` distinct-user count for
     opted-in users after backfill.
  3. Opting-in via /settings on ygoprices.io lands the
     contact with the right topics within ~1 minute; a
     mapping row appears.
  4. Opting-out via /settings flips the topic subscription
     within ~1 minute; mapping row stays; `unsubscribed`
     field on the Resend contact remains false.
  5. Secure Email Change flow: change an opted-in user's
     email via CN-C; next sync cycle PATCHes the existing
     contact with the new email; Resend dashboard shows the
     same contact id with updated email; `synced_email` in
     the mapping row matches.

### CN-D2 — Reverse sync via Resend webhook

**Gate:** design the global-unsubscribe correlation-window
mechanics (see "Global unsubscribe semantics" above) and
record N (seconds) + tie-breaker rule in this doc before
CN-D2 code starts. Suggested starting N = 30.

- Edge function `resend-webhook`:
  - Standard Webhooks signature verification via reused
    `_shared/verify-webhook.ts` (secret =
    `RESEND_WEBHOOK_SECRET`).
  - Lookup user by `resend_contact_id` via
    `collector_marketing_contacts`. Unknown contact → 204
    no-op + log (likely PokePrices legacy or an orphan).
  - Route to consent RPCs OR deliverability RPCs per the
    reverse-sync table above. Never both, except
    `contact.deleted` which triggers both defensively.
- **Consent RPCs** (SECURITY DEFINER, atomic preference +
  event writes, `search_path=''`):
  - `public.apply_resend_topic_change(p_user_id uuid,
    p_scope text, p_site_code text, p_opt_in boolean)` — one
    scope; one event with `consent_source='resend_webhook'`.
  - `public.apply_resend_global_marketing_withdrawal(p_user_id
    uuid)` — iterates every scope the user currently carries;
    opt-out + event per scope. Never writes deliverability.
- **Deliverability RPC**:
  - `public.record_email_delivery_state(p_user_id uuid,
    p_status text, p_reason text, p_resend_event_id text)` —
    upserts `collector_email_delivery_state`; appends
    `collector_email_delivery_events`. Never writes consent.
- Configure the Resend webhook endpoint in the dashboard —
  subscribe to `contact.updated`, `contact.deleted`,
  `email.bounced`, `email.complained`, `suppression.added`,
  `suppression.removed`.
- **Tests:**
  - signature rejection (missing / stale / tampered).
  - `contact.updated` with one topic flipped opt_in→opt_out
    → one consent preference row updated; one consent event
    with `source='resend_webhook'`; other scopes untouched;
    deliverability state untouched.
  - `contact.updated` with `unsubscribed=true`, NO recent
    bounce/complaint/suppression for this user → treated as
    user-initiated global marketing withdrawal; opt-out on
    every current scope; deliverability state untouched.
  - `contact.updated` with `unsubscribed=true`, WITHIN the
    correlation window of an `email.bounced` Permanent for
    same user → skipped (deliverability already recorded);
    consent tables untouched.
  - `email.bounced` Permanent → deliverability row status =
    `hard_bounce`; consent tables untouched; consent history
    preserved.
  - `email.bounced` Temporary → deliverability row status =
    `soft_bounce_watch`; consent tables untouched.
  - `email.complained` → deliverability status = `complaint`.
  - `suppression.added` → deliverability status =
    `provider_suppressed`.
  - `suppression.removed` → deliverability status =
    `deliverable` with reason = `'suppression-lifted'`.
  - `contact.deleted` → BOTH consent global withdrawal AND
    deliverability `manual_suppressed` written (defensive).
  - Unknown Resend contact id → 204 no-op + log.
  - Unknown topic id in a `contact.updated` payload → topic
    skipped, other topics processed, log emitted.
  - No tokens / emails / api-keys leaked in log summaries
    (CN-C invariant preserved).
- **STOP** for manual verification:
  1. Trigger a topic unsubscribe from Resend's preference
     page for the test recipient → Supabase preference row
     for that scope flips within ~2 s, event row with
     `source='resend_webhook'` appears, deliverability
     table untouched, `collector_marketing_consent_events.occurred_at`
     matches event delivery.
  2. Bounce a message to a known-bad address → deliverability
     row appears with status `hard_bounce`; consent tables
     for that user untouched; consent history intact.

### CN-D3 — Ops surface + drift detection

- Read view `collector_marketing_sync_status` exposing
  `last_event_id`, `last_run_at`, `last_error`, failure count.
- Read view `collector_email_deliverability_summary` — one row
  per non-`deliverable` state count, for at-a-glance ops.
- Periodic (daily) drift check job: pick a small sample of
  opted-in users, `GET /contacts/{resend_contact_id}` for each,
  verify the topic subscriptions returned match Supabase state,
  log discrepancies. Cheap — samples, not full audit.
- Reconciliation runbook (one page): "user reports still
  receiving newsletter after opting out" — order of checks
  (Supabase pref → sync failure row → Resend contact topics →
  deliverability state).
- Alerting hooks (log-based; no PagerDuty integration in this
  slice).
- Docs: closure doc for CN-D + the runbook.

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

- **PATCH topics semantics is a Gate B question, not a
  post-launch bite-mark.** Run the experiment before CN-D1.
  Regardless of finding, forward sync sends the full vector
  defensively; the finding only informs cost analysis and the
  reverse-sync diff strategy.
- **Global `unsubscribed` blocks broadcasts, not transactional.**
  Docs describe `unsubscribed` in terms of "all Broadcasts,"
  implying transactional (CN-C auth email) is unaffected. Verify
  at CN-D1 with a live test address before trusting it. Ties
  into the suppression-list concern below.
- **Suppression list is account-global.** A hard bounce on any
  send (including auth email) adds the address to the account
  suppression list, which stops ALL future sends including
  transactional auth email. This is a Resend platform behaviour
  we can't disable; CN-D's mitigation is (a) reverse-sync
  `suppression.added` fast into `collector_email_delivery_state`
  and (b) surface a "your account email may be undeliverable"
  flag in the user's own /settings page (post-CN-D concern, but
  the deliverability table now supplies the fact).
- **Email as identity, solved v3.** Contact-mapping table keys
  off `resend_contact_id`, so Secure Email Change becomes a
  drift check + one PATCH with `email` set to the new address.
  No separate `collector_email_changes` queue needed. The sync
  worker naturally picks this up because CN-C's email-change
  fires a consent event (via `apply_signup_marketing_consent` or
  future logic) OR — worst case — the daily drift check in
  CN-D3 catches it within 24 h.

  **Refinement to consider:** if we want < 1 h latency on
  email drift, add a tiny `on update` trigger on
  `auth.users(email)` that inserts a synthetic row into
  `collector_marketing_sync_failures` (retry_after=now()) so
  the next sync cycle wakes up on it. Cheap; document at
  CN-D1 whether we want it.
- **Rate limits.** Resend enforces per-second limits on the
  contact API. Batch size cap + exponential backoff on 429 in
  the sync function.
- **PII in logs.** Same rule as CN-C: never log the recipient
  email in full; domain-only tag for observability. No tokens
  or webhook payload bodies in logs.
- **Reverse-sync ambiguity (`unsubscribed=true`).** The
  correlation-window design is a hard gate on CN-D2. Get it
  wrong and we either (a) misclassify user-initiated
  unsubscribes as bounces and lose the consent event, or (b)
  misclassify bounces as user withdrawals and add fake consent
  events to the immutable ledger.

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
