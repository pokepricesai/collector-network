# CN-D1 amendment: email-change nudge trigger

Status: **APPLIED** to project `egidpsrkqvymvioidatc` on
2026-09-26 alongside CN-D1 Test C.

## Why this exists

CN-D1's reconciliation worker processes users on two signals:
- new consent events since the cursor, and
- users due for retry in `collector_marketing_sync_failures`.

An `auth.users.email` change alone creates neither. That gap was
flagged in `docs/network/plan-cn-d.md` as a "bite-mark" during v3
design and surfaced during Test C's live Secure Email Change
smoke — the mapping row's `synced_email` drifted from
`auth.users.email` and no cron fire would ever reconcile it
without a nudge.

This migration installs an `AFTER UPDATE OF email` trigger on
`auth.users` that seeds a synthetic `sync_failures` row with
`last_error = 'email_change_nudge'` and `next_retry_at = now()`
whenever a managed contact's email changes. The next cron fire
picks the user up via `getUsersDueForRetry`, `syncUser` detects
drift (`mapping.syncedEmail != normalise(auth.users.email)`),
and `PATCH /contacts/{resend_contact_id}` updates the email in
place — same contact id, no duplicate.

## Invariants (all must hold)

1. Fires only when `new.email is distinct from old.email`. Same
   value → no-op.
2. Only nudges users **already** present in
   `public.collector_marketing_contacts`. Unmanaged /
   shared-account users whose email happens to change never
   gain marketing state as a side effect.
3. Does not create any marketing state — writes exclusively to
   `collector_marketing_sync_failures`, no other table.
4. **Fail-open:** an inner `begin/exception when others then null
   end` block swallows any error from the retry-queue write so
   an `auth.users` email update can never be aborted by a
   downstream CN-D1 issue.
5. `SECURITY DEFINER` with hardened `set search_path = ''` and
   schema-qualified references (`public.collector_marketing_contacts`,
   `public.collector_marketing_sync_failures`).
6. `EXECUTE` revoked from `PUBLIC`, `anon`, `authenticated`;
   granted only to `service_role`.

## Migration (idempotent, safe to re-run)

```sql
begin;

create or replace function public.collector_marketing_sync_on_email_change()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
as $$
begin
    if new.email is distinct from old.email then
        if exists (
            select 1
              from public.collector_marketing_contacts
             where user_id = new.id
        ) then
            begin
                insert into public.collector_marketing_sync_failures
                    (user_id, attempts, last_error, last_attempt_at, next_retry_at)
                values
                    (new.id, 0, 'email_change_nudge', now(), now())
                on conflict (user_id) do update
                    set attempts        = 0,
                        last_error      = 'email_change_nudge',
                        last_attempt_at = now(),
                        next_retry_at   = now();
            exception
                when others then
                    -- Swallow all. auth.users email update must
                    -- succeed independently of the retry queue.
                    null;
            end;
        end if;
    end if;
    return new;
end;
$$;

revoke all on function public.collector_marketing_sync_on_email_change() from public;
revoke all on function public.collector_marketing_sync_on_email_change() from anon;
revoke all on function public.collector_marketing_sync_on_email_change() from authenticated;
grant execute on function public.collector_marketing_sync_on_email_change() to service_role;

drop trigger if exists collector_marketing_sync_on_email_change on auth.users;
create trigger collector_marketing_sync_on_email_change
    after update of email on auth.users
    for each row
    execute function public.collector_marketing_sync_on_email_change();

commit;
```

## Verification (post-apply)

```sql
-- 1. Trigger exists, enabled, scoped to auth.users(email) updates.
select tgname, tgrelid::regclass::text as target_table,
       (tgenabled = 'O')::text as enabled,
       pg_get_triggerdef(oid) as def
  from pg_trigger
 where tgname = 'collector_marketing_sync_on_email_change';
-- Expect one row: target_table = auth.users, enabled = true,
--                  def includes "AFTER UPDATE OF email".

-- 2. Function privilege audit.
select 'anon'          as role, has_function_privilege('anon',          'public.collector_marketing_sync_on_email_change()', 'execute') as granted
union all
select 'authenticated',        has_function_privilege('authenticated', 'public.collector_marketing_sync_on_email_change()', 'execute')
union all
select 'service_role',         has_function_privilege('service_role',  'public.collector_marketing_sync_on_email_change()', 'execute')
order by role;
-- Expect: anon = f, authenticated = f, service_role = t.
```

Both queries returned the expected values on 2026-09-26 (see
CN-D1 close-out report).

## Coverage note

The trigger's *logic* is DB-side and can't be unit-tested from
Node. Its *effect* (a synthetic row flows through the retry
queue exactly like a real failure row) is covered by the
existing sync-worker tests in
`supabase/functions/_shared/sync-worker.test.ts`:

- `runReconcile: also processes users on the retry queue in the same cycle`
- `syncUser: email drift → PATCH email (no segments field), then check segment + topics`
- `syncUser: GET segments returns 404 → falls back to POST /contacts + upserts mapping`

Together these prove the nudge-produced retry row is treated
identically to any other failure row and correctly repairs a
drifted `synced_email` in place.

## Rollback

```sql
drop trigger if exists collector_marketing_sync_on_email_change on auth.users;
drop function if exists public.collector_marketing_sync_on_email_change();
```

Rollback is safe — it simply reverts CN-D1 to its pre-Test-C
state, where email changes go undetected. Any live drift can be
one-off nudged by inserting a row into
`collector_marketing_sync_failures` (see the Test C one-off
seed pattern in `cn-d1-deploy.md`).
