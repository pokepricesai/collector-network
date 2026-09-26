# CN-D1 deployment runbook

Status: **APPLIED — CN-D1 CLOSED 2026-09-26.** All 11 steps
executed against `egidpsrkqvymvioidatc`. Cadence stepped from
`* * * * *` to `*/5 * * * *` after Test C. Email-drift trigger
installed post-Test-C via
`docs/network/schema-request-cn-d1-email-nudge.md`. See
`docs/network/cn-d1-review.md` for the full live-results table.

The runbook below is retained as canonical procedure for
re-runs (new brand onboarding, disaster recovery, or
audit reconstruction).

---

Prereqs:
- Supabase CLI ≥ 2.115 (currently 2.115.0 installed).
- Resend dashboard access on the shared workspace (same
  workspace as CN-C — confirmed in Gate A).
- A local Bash / PowerShell session capable of running
  `openssl rand -hex 32` (or equivalent) for generating the
  trigger secret.

## Secrets summary

Two new Supabase secrets. Nothing else changes.

| Name | Purpose | Blast radius if leaked |
|---|---|---|
| `MARKETING_RESEND_API_KEY` | Read/write Resend `/contacts`, `/topics`. Never touches transactional `/emails`. | Marketing subscription state only — auth email keeps working via CN-C's separate `RESEND_API_KEY`. |
| `MARKETING_SYNC_TRIGGER_SECRET` | Bearer token that the edge function requires on every call. Same secret for cron traffic and backfill invocations. | Someone with the secret can trigger reconciliation (harmless — idempotent) or backfill. Rotate immediately if leaked. |

Neither secret literal ever lands in git, source, migrations, or
logs. The pg_cron job reads the trigger secret from Supabase
Vault by name.

## Step 1 — Apply schema migration

Open `docs/network/schema-request-cn-d1.md` in the Supabase SQL
Editor. Run the full `begin; ... commit;` block.

Verify:

```sql
select table_name from information_schema.tables
  where table_schema = 'public'
    and table_name like 'collector_marketing_%'
  order by table_name;
-- Expect 5 rows:
--   collector_marketing_config
--   collector_marketing_contacts
--   collector_marketing_sync_failures
--   collector_marketing_sync_state
--   collector_marketing_topics

select id, last_event_occurred_at, last_event_id
  from collector_marketing_sync_state where id = 'primary';
-- Expect one row, both event fields null.

select routine_name from information_schema.routines
  where routine_schema = 'public'
    and routine_name like 'collector_marketing_%';
-- Expect:
--   collector_marketing_events_since
--   collector_marketing_sync_record_failure
```

## Step 2 — Create Resend Segment + Topics (manual, dashboard)

Resend dashboard on the shared workspace. Do NOT touch the
existing `General` segment or the two `Untitled` broadcast
drafts.

1. **Segments** → **New segment**.
   - Name: `Collector Network Contacts`.
   - Copy the returned UUID → paste into `$SEGMENT_ID`.

2. **Topics** → **New topic**:
   - Name: `site:ygo`
   - `default_subscription`: **opt_out**
   - Visibility: private
   - Copy UUID → `$YGO_TOPIC_ID`.

3. **Topics** → **New topic**:
   - Name: `network`
   - `default_subscription`: **opt_out**
   - Visibility: private
   - Copy UUID → `$NETWORK_TOPIC_ID`.

Do NOT create topics for `site:mtg` / `site:pokemon` /
`site:onepiece` / `site:lorcana` in CN-D1.

## Step 3 — Seed the config rows

Substitute the three UUIDs from Step 2 and run in the SQL
Editor:

```sql
begin;

insert into collector_marketing_config (id, resend_segment_id)
values ('primary', '<SEGMENT_ID>');

insert into collector_marketing_topics
  (scope,     site_code, resend_topic_id,       active, default_subscription)
values
  ('site',    'ygo',     '<YGO_TOPIC_ID>',      true,   'opt_out'),
  ('network', null,      '<NETWORK_TOPIC_ID>',  true,   'opt_out');

commit;
```

Verify:

```sql
select * from collector_marketing_config;
select scope, site_code, resend_topic_id, active from collector_marketing_topics
  order by scope, site_code nulls first;
```

## Step 4 — Provision the two Supabase secrets

Generate a strong random trigger secret (do not paste it into
chat):

```powershell
# PowerShell
[System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([Guid]::NewGuid().ToString() + [Guid]::NewGuid().ToString()))
# or: openssl rand -base64 48   (Git Bash / WSL)
```

Set both secrets against the correct project ref:

```powershell
supabase secrets set MARKETING_RESEND_API_KEY=re_******** `
  --project-ref egidpsrkqvymvioidatc

supabase secrets set MARKETING_SYNC_TRIGGER_SECRET=<the-generated-secret> `
  --project-ref egidpsrkqvymvioidatc
```

Verify:

```powershell
supabase secrets list --project-ref egidpsrkqvymvioidatc | Select-String -Pattern "MARKETING_"
# Expect both names present; values masked.
```

## Step 5 — Store the trigger secret in Supabase Vault

pg_cron needs the trigger secret to authenticate to the edge
function. Vault stores it encrypted; the cron job reads it via
`vault.decrypted_secrets`.

In the SQL Editor, with the same secret value you used in Step
4 for `MARKETING_SYNC_TRIGGER_SECRET`:

```sql
-- Ensure the vault extension is enabled (Supabase enables it
-- by default on all projects, but idempotent to be sure).
create extension if not exists vault schema vault;

select vault.create_secret(
  '<the-same-generated-secret-you-used-in-step-4>',
  'marketing_sync_trigger_secret',
  'CN-D1: Bearer token for sync-marketing-contacts edge function'
);
```

Verify (the raw value is NOT visible — only its name and
metadata):

```sql
select name, description, created_at
  from vault.secrets
  where name = 'marketing_sync_trigger_secret';
```

**Do not commit the secret value anywhere.** After running
`vault.create_secret` in the SQL editor, clear your clipboard
and shell history.

## Step 6 — Deploy the edge function

```powershell
supabase functions deploy sync-marketing-contacts `
  --project-ref egidpsrkqvymvioidatc `
  --no-verify-jwt
```

## Step 7 — Backfill invocation (manual)

Authenticated one-shot. Uses the same trigger secret from Step
4 / Step 5.

```powershell
# Set the trigger secret in your local session ONLY (never in a
# committed file):
$env:MARKETING_SYNC_TRIGGER_SECRET = Read-Host -AsSecureString -Prompt "Trigger secret" |
  ForEach-Object { [System.Net.NetworkCredential]::new("", $_).Password }

# Invoke backfill.
curl.exe -sS -X POST `
  "https://egidpsrkqvymvioidatc.supabase.co/functions/v1/sync-marketing-contacts?backfill=1" `
  -H "Authorization: Bearer $env:MARKETING_SYNC_TRIGGER_SECRET"
```

Expected response body:

```json
{"processed":<N>,"succeeded":<N>,"failed":0,"noop":0,"backfill":true,"cursorAdvanced":false}
```

Where `<N>` is the count of users who have an actual row in
`collector_marketing_preferences` for `site:ygo` or `network`.
Note: `<N>` will NOT include CN-A `collector_user_sites`
membership users — the worker deliberately excludes them
because membership is not consent (Amendment 1).

Clear the session secret:

```powershell
$env:MARKETING_SYNC_TRIGGER_SECRET = $null
```

## Step 8 — Verify in the Resend dashboard

Verify BOTH segment membership AND topic subscriptions for
every backfilled contact.

- **Segments** → `Collector Network Contacts` should show
  `<N>` members matching the backfill response body's
  `succeeded` count.
- For each contact currently in `General` (PokePrices legacy):
  it must ALSO appear in `Collector Network Contacts` if that
  user has a CN marketing preference row. `General`
  membership must NOT have been removed. The two segments
  co-exist.
- Contacts NOT in the Supabase preference table must NOT
  appear in `Collector Network Contacts` — Amendment 1
  (membership is not consent) is what stops CN-A backfilled
  users without preferences from ending up here.
- Click each contact → **Segments** tab. Confirm it lists at
  least `Collector Network Contacts`. If the contact was
  already in `General` or another segment, confirm those are
  still present.
- Click each contact → **Topics** tab. Confirm the
  `subscription` for each topic matches the Supabase
  preference:
  - `site:ygo` = `opt_in` when
    `collector_marketing_preferences.email_opt_in = true` for
    scope=site, site_code=ygo. Else `opt_out` — or the topic
    may be absent if the user has no preference row for it
    (Amendment 1).
  - `network` = same rule against scope=network,
    site_code=null.
- Existing PokePrices state — `General` segment, both
  `Untitled` broadcast drafts, verified domains — is
  unchanged.

Also run the privilege audit block from
`docs/network/schema-request-cn-d1.md` §"Post-migration
verification". Every anon/authenticated row must return `f`,
every service_role row must return `t`. Any `t` in the wrong
column blocks Step 9.

## STOP checkpoint

**Do not enable the pg_cron schedule until preflightluke
confirms Step 8.**

Report back the observed contact count + a spot-check of one
contact's topic subscriptions. Only then proceed to Step 9.

## Step 9 — Enable pg_cron schedule (post-approval)

Run in the SQL Editor. The Authorization header is composed at
send-time from `vault.decrypted_secrets` — the secret literal
never appears in this SQL.

```sql
-- Requires the pg_cron + pg_net extensions. Supabase enables
-- both by default on all Postgres 15+ projects; the
-- `create extension` calls are idempotent.
create extension if not exists pg_cron  schema extensions;
create extension if not exists pg_net   schema extensions;

select cron.schedule(
  'sync-marketing-contacts',
  '* * * * *',
  $$
  select
    net.http_post(
      url := 'https://egidpsrkqvymvioidatc.supabase.co/functions/v1/sync-marketing-contacts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'marketing_sync_trigger_secret'
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

Verify:

```sql
select jobid, jobname, schedule, active from cron.job
  where jobname = 'sync-marketing-contacts';
-- Expect one row, schedule='* * * * *', active=true.

-- After the first minute, check the recent invocations:
select status, return_message, created
  from net._http_response
  where url like '%sync-marketing-contacts%'
  order by created desc limit 5;
-- Expect status=200 rows, no 401/500.
```

## Step 10 — Live smoke test

With the cron running:

1. Sign in as a real YGO user; visit `/email-preferences`.
2. Toggle the YGO opt-in ON. Save.
3. Wait ~60-90 s.
4. Confirm the contact appears in the `Collector Network
   Contacts` segment (Resend dashboard → Segments) AND the
   contact's Topics tab shows `site:ygo` = `opt_in`.
5. Toggle the YGO opt-in OFF. Save.
6. Wait ~60-90 s.
7. Confirm the contact's `site:ygo` flipped to `opt_out`.
   The contact remains in the segment (never deleted, never
   `unsubscribed=true`). If the contact also had `General`
   before (PokePrices legacy), it must STILL have `General`.
8. Trigger a Secure Email Change for the same user via
   `/settings`. Confirm both emails.
9. Wait ~60-90 s.
10. Confirm the SAME Resend contact id now shows the new
    email. `collector_marketing_contacts.synced_email`
    matches. Segment membership unchanged.

## Step 11 — Cadence step-down (post-validation)

After ~24 h of clean logs at 1-minute cadence, step down:

```sql
select cron.alter_job(
  job_id  := (select jobid from cron.job where jobname = 'sync-marketing-contacts'),
  schedule := '*/5 * * * *'
);
```

## Rollback

If any step fails after Step 6:

```sql
-- Disable the cron job (leave the row in place for audit).
select cron.unschedule('sync-marketing-contacts');
```

```powershell
# Undeploy the function (leaves migrations + secrets intact).
supabase functions delete sync-marketing-contacts `
  --project-ref egidpsrkqvymvioidatc
```

Data is safe: no consent rows were written by CN-D1, and Resend
contacts can be deleted manually from the dashboard if we ever
want to reset the segment (rare — additive semantics mean
re-running the worker converges naturally).

## Cleanup of secrets on final wind-down (not applicable to
launch, but documented for completeness)

```powershell
supabase secrets unset MARKETING_RESEND_API_KEY `
  --project-ref egidpsrkqvymvioidatc
supabase secrets unset MARKETING_SYNC_TRIGGER_SECRET `
  --project-ref egidpsrkqvymvioidatc
```

```sql
select vault.delete_secret(id)
  from vault.secrets
  where name = 'marketing_sync_trigger_secret';
```
