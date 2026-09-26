# CN-D architecture + slice plan (proposal)

Status: **PROPOSAL** — architecture only. Not started. Awaiting
CN-C closure and preflightluke's sign-off on this plan.

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

## Resend Contacts data model

Resend groups contacts into **audiences**. CN-D maps one audience
per Collector Network mailing list:

| Scope | Site code | Resend audience | Active at CN-D launch? |
|---|---|---|---|
| site | `ygo` | YGOPrices audience | yes |
| site | `mtg` | MTGPrices audience | when the site launches |
| site | `pokemon` | PokePrices audience | when the site launches |
| site | `onepiece` | One Piece audience | when the site launches |
| site | `lorcana` | Lorcana audience | when the site launches |
| network | — | Collector Network audience | yes |

The mapping lives in a new small config table so audience IDs are
DB-owned, not baked into the edge function code:

```sql
create table collector_marketing_audiences (
  scope        text not null check (scope in ('site','network')),
  site_code    text references collector_sites(code),
  resend_audience_id text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((scope = 'site' and site_code is not null)
      or (scope = 'network' and site_code is null))
);
create unique index collector_marketing_audiences_scope_site
  on collector_marketing_audiences (scope, coalesce(site_code, ''));
```

Rows are added by preflightluke when each audience is created in
the Resend dashboard. Rows can be marked inactive to freeze sync
for one audience without a schema change.

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

Resend sends webhooks for `email.bounced`, `email.complained`,
and audience-level unsubscribe events (per audience). CN-D
consumes those in a second Edge Function `resend-webhook`:

1. Standard Webhooks (Resend uses the same scheme as CN-C)
   signature verification. Reuse `verify-webhook.ts` from CN-C.
2. Parse event; route on type:
   - `contact.updated` with `unsubscribed=true` → find user by
     (email, audience → scope/site), call
     `apply_resend_unsubscribe(v_user, v_scope, v_site_code)`.
   - `email.bounced` (hard) → same as unsubscribe for that
     recipient (soft bounces are ignored on first offence).
   - `email.complained` → same as unsubscribe.
3. RPC writes the preference row (`email_opt_in=false`,
   `withdrawn_at=now()`, `consent_source='resend_webhook'`) AND
   the consent event atomically, exactly like the user-driven
   RPCs.

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
| Audience config | `collector_marketing_audiences` table |
| Watermark | `collector_marketing_sync_state` table |
| Retry state | `collector_marketing_sync_failures` table |
| Reverse-sync RPC | `public.apply_resend_unsubscribe(user, scope, site)` |
| Forward sync worker | `supabase/functions/sync-marketing-contacts/` |
| Webhook handler | `supabase/functions/resend-webhook/` |
| Shared: audience mapper + Resend contact transport | `supabase/functions/_shared/resend-contacts.ts` |
| Shared: verify-webhook.ts | reused from CN-C |
| pg_cron trigger | `select cron.schedule(...)` calling the sync fn URL |

## Slice breakdown

Three tight slices. Each ships independently and is a STOP
checkpoint for manual verification before the next.

### CN-D1 — Schema + audience config + forward sync

- Schema migration: `collector_marketing_audiences`,
  `collector_marketing_sync_state`,
  `collector_marketing_sync_failures`. Add `resend_webhook`,
  drop `brevo_webhook` in the CN-A consent CHECK constraints.
- Manual: create the YGO + Network audiences in Resend, capture
  their IDs, `INSERT` two config rows.
- Edge function `sync-marketing-contacts`:
  - Reads watermark, events since, current preferences.
  - Diffs against Resend (`GET` audience contacts is expensive
    at scale — we call `POST/PATCH` blind; Resend's create is
    idempotent by email within an audience).
  - Advances watermark on success.
- pg_cron schedule (`* * * * *` initially; tune down to `*/2`
  or `*/5` once backfill lands).
- One-time backfill mode (`BACKFILL=1` flag).
- Tests (mock fetch, no live Resend credits):
  - opt-in event → Resend POST /audiences/:id/contacts with the
    user email
  - opt-out event → Resend PATCH unsubscribed=true
  - unchanged event → no Resend call
  - Resend 5xx → watermark not advanced
  - onepiece / lorcana inactive → sync skipped, no error
  - malformed audience config → sync skipped, logged
- Docs: `docs/network/cn-d1-manual-setup.md` covering audience
  creation, config INSERTs, backfill run.
- STOP for manual dashboard verification + backfill.

### CN-D2 — Reverse sync via Resend webhook

- Edge function `resend-webhook`:
  - Standard Webhooks signature verification.
  - Route by event type.
  - Look up user + audience → scope + site.
  - Call `apply_resend_unsubscribe(user_id, scope, site_code)`.
- RPC `public.apply_resend_unsubscribe` — SECURITY DEFINER,
  same atomic pattern as `set_*_marketing_preference` but with
  source = `'resend_webhook'`.
- Configure the Resend webhook endpoint in the dashboard.
- Tests:
  - signature rejection
  - unsubscribe event → preference opt-out + consent event with
    source = resend_webhook
  - bounce (hard) → same
  - complaint → same
  - unknown email → 204 no-op (Supabase user was deleted)
  - unknown audience → 204 no-op + logged
- STOP for manual verification (trigger an unsubscribe from a
  test Resend link, confirm the Supabase row flipped).

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

- **Audience membership is soft-deletable in Resend.** A user
  who opts out then back in must re-appear as an active
  subscriber in the same audience — verify at CN-D1 that a
  patched `unsubscribed=false` on an existing contact works and
  we don't need to DELETE + POST.
- **Email as identity.** Resend keys contacts by email. If a
  user changes their email via CN-C Secure Email Change, we
  need to update the Resend contact's email too. Add a hook to
  CN-D1's sync: any `email_changed` event on `auth.users`
  triggers a full re-sync for that user. (Supabase does not
  natively emit `email_changed` events; we cover it via a small
  `on update` trigger on `auth.users(email)` that inserts a
  synthetic row into a `collector_email_changes` table that the
  sync worker also drains.)
- **Rate limits.** Resend has per-second contact API limits.
  Batch size cap in the sync function + backoff on 429.
- **PII in logs.** Same rule as CN-C: never log the recipient
  email in full; domain-only tag for observability.

## Open questions for preflightluke before starting CN-D1

1. Should the Resend audience for `network` be its own audience
   (one blast reaches every subscriber), or should we treat
   "network" as "opted into ANY site's audience" and re-derive
   at send time? Recommendation: dedicated audience — clean
   sends and Resend engagement scoring works per audience.
2. Do we want to run backfill immediately at CN-D1 launch, or
   wait until MTG/Pokemon are ready and backfill once for all
   active sites? Recommendation: run backfill for YGO + Network
   at CN-D1, then again incrementally as each site launches
   (same edge function, run once per site).
3. Sync cadence: 1 min feels responsive but wastes function
   invocations when the change feed is empty. Recommendation:
   1 min through CN-D1 rollout / verification, then 5 min in
   steady state.
