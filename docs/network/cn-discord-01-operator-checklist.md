# CN-DISCORD-01 operator setup checklist

**Status:** PR #1 (schema + dry-run reconciliation + tests) ships with every flag OFF.
**You must complete this checklist before member access becomes live.**

Each step is safe on its own; nothing synchronises until step 7's flag flip.

---

## 1. Reuse the existing Collector Network Discord application

We already have one. **Do not create a new application.** Open https://discord.com/developers/applications and pick the existing one.

## 2. Add a bot user to that application (if it does not already have one)

- **Bot → Add Bot** (if not already present).
- Under **Privileged Gateway Intents**: leave **ALL three OFF**. CN-DISCORD-01 needs none of them.
- Under **OAuth2 → URL Generator**: scopes = `bot`; bot permissions = `Manage Roles` **only**. Nothing else.

**Copy the bot token.** You will paste it into Vercel env in step 5. Do not send it in chat and do not put it into a committed `.env` file.

## 3. In the Collector Network Discord server

- Create two roles: `cn-free` and `cn-premium`. Give them any colour; ensure neither has any permission set beyond "View Channels".
- Open **Server Settings → Roles** and drag the bot's auto-role **above** `cn-free` and `cn-premium`. Discord refuses role assignments otherwise.
- Right-click the server icon → **Copy Server ID** (you need Developer Mode on in Advanced settings). This is the guild ID.
- In each role's context menu, **Copy Role ID** for `cn-free` and `cn-premium` separately.

## 4. Invite the bot to the server

Use the OAuth2 URL you generated in step 2. Grant it. Verify it appears in the member list with the auto-role you set above the two tier roles.

## 5. Vercel env (Hub project only)

Add to the Hub Vercel project (production scope):

- `DISCORD_BOT_TOKEN` = the token from step 2.
- `DISCORD_GUILD_ID` = the server ID from step 3.

The token is secret — use Vercel's encrypted env, never the shared `.env` files. Nothing else in the monorepo reads this.

## 6. Seed the role bindings in Supabase

Run in Supabase SQL (as service_role; the table is operator-only):

```sql
insert into collector_discord_role_bindings (tier, discord_role_id, label)
values
  ('free',    '<ROLE_ID_FROM_STEP_3>',    'cn-free'),
  ('premium', '<ROLE_ID_FROM_STEP_3>',    'cn-premium')
on conflict (tier) do update
  set discord_role_id = excluded.discord_role_id,
      label           = excluded.label,
      updated_at      = now();
```

Also set the guild id in config if you did not set `DISCORD_GUILD_ID`:

```sql
update collector_discord_guild_config
  set guild_id = '<SERVER_ID>'
  where id = 1;
```

## 7. Verify the dry-run before you flip

The hourly cron (`/api/cron/discord-role-sync`, schedule `0 * * * *`) is already registered and fires regardless of the flag.

- Wait for the next natural fire, or trigger from Vercel Dashboard → Cron.
- Open the audit log:
  ```sql
  select action, result, desired_tier, count(*)
  from collector_discord_role_sync_log
  where created_at > now() - interval '2 hours'
  group by 1,2,3
  order by 4 desc;
  ```
- Expect rows with `result = dry_run` and `action in ('add_role','remove_role','skip_disconnected','skip_no_binding','skip_suspended')`. **Zero `error_*` results.**
- Pick one `action='add_role'` row where you personally know the user and confirm the `desired_tier` is correct for that user.

## 8. Flip to live

Only after step 7 looks correct:

```sql
update collector_discord_guild_config
  set role_sync_enabled = true
  where id = 1;
```

The next cron fire will apply roles for real. Dry-run rows stop appearing in the audit log; `result = ok` and `result = error_*` take their place.

## 9. Private verification before member access

- Have one trusted operator link their Discord via `/account` on any of the five sites.
- Wait for the next cron fire.
- Confirm the operator now holds `cn-free` in Discord.
- Use `collector_set_membership_tier` (service_role only) to promote the operator to premium.
- Wait for the next cron fire.
- Confirm the role transitioned to `cn-premium`.
- Revert the operator to free and confirm the reverse transition.
- **Only after all four state transitions verify successfully** is the system ready for public member access (that activation is a separate milestone, not part of CN-DISCORD-01).

## 10. Panic switch

If anything goes wrong at step 8+, flip back to dry-run instantly:

```sql
update collector_discord_guild_config
  set role_sync_enabled = false
  where id = 1;
```

The next cron fire will stop mutating Discord. The role assignments it already applied remain in Discord (removing them is a separate decision).
