# Collector Network OS — architecture (Phase 0)

This document is the rulebook for every later pass that touches the
Collector Network Operating System. Phase 0 established the
foundation; it must not be regressed as later features land.

## What the OS is

An internal operating system for the five specialist Collector
Network sites (PokePrices, MTGPrices, YGOPrices, OnePiecePrices,
LorcanaPrices). It observes, decides, drafts and queues actions
across the network. It is **not** a database for cards or prices;
those remain in each site's own domain and are read, not written,
by the OS.

Lives at `apps/hub/src/app/admin/*` inside the Collector Network
umbrella application. Deployed as part of the existing
`collector-network` Vercel project. There is no separate admin
application in Phase 0; a future split into `apps/admin` (private
subdomain) remains open but is not scheduled.

## Data layers

### Layer 1 — Central operational database (Postgres via Supabase)

All OS state lives in the shared Supabase project (`egidpsrkqvymvioidatc`)
under the `network_*` table namespace. This is the only database
layer touched by the admin UI in Phase 0.

Tables:

| Table | Purpose |
|---|---|
| `network_sites` | Canonical registry of the five sites |
| `network_admin_users` | Explicit admin authorisation list |
| `network_integrations` | Connector registry (status, credential pointer, never raw secrets) |
| `network_data_sources` | Source codes for provenance tracking |
| `network_metric_definitions` | Catalogue of metric codes |
| `network_daily_metrics` | Long-format daily values |
| `network_job_runs` | Background job execution history |
| `network_tasks` | Central to-do model |
| `network_alerts` | Automatically-detected signals |
| `network_approvals` | Human-approval gate for AI/system actions |
| `network_audit_log` | Append-only trail of consequential actions |
| `network_settings` | Key-value config, site-scoped or network-wide |

RLS is enabled on every table. Every policy checks
`public.network_is_admin()`, which looks the caller up in
`network_admin_users` with `is_active = true`. A regular consumer
account on the same Supabase project has zero access.

### Layer 2 — Analytics warehouse (not implemented in Phase 0)

Long-horizon GSC, GA, affiliate and KPI history will later move
into an analytical warehouse (BigQuery, ClickHouse or equivalent).
Phase 0 deliberately keeps the daily-metric table in Postgres so the
UI can render day-ones; later phases introduce the warehouse behind
a thin abstraction (`loadMetricSeries(metric, site, from, to)`) so
UI and task scoring do not care which layer served the row.

Rule: any time a feature needs to persist large time-series rows,
check first whether the warehouse abstraction exists. If not, the
rows should live in `network_daily_metrics` **only** if the volume
stays below ~1M rows across the network.

### Layer 3 — Production site databases

The five consumer sites keep their own card / set / pricing /
collection schemas. The OS **MUST NOT** write to them in general.
Later ingest connectors may read them (freshness checks, user
counts, article discovery) through the shared Supabase project's
anon or service-role credentials — read-only transactions, no
migrations, no `UPDATE` or `DELETE` statements.

Any future need to write to a production site DB must land as an
explicit, approved task — not an incidental side-effect of a
Collector Network OS feature.

## Site model

Every record that can be site-scoped carries `site_id uuid` with
`null` meaning network-wide. The five seed slugs are stable:

- `pokemon` → PokePrices
- `mtg` → MTGPrices
- `ygo` → YGOPrices
- `onepiece` → OnePiecePrices
- `lorcana` → LorcanaPrices

Later modules must look sites up via `network_sites` (code example
in `apps/hub/src/server/admin/sites.ts`). Do not hardcode site
metadata in UI or server code.

## Admin authentication

Two layers, both required.

1. The caller has a valid Supabase session (any auth method the
   umbrella already supports). This proves identity.
2. `public.network_admin_users` has an active row for that
   `auth.users.id`. This proves authorisation.

An ordinary PokePrices / YGO / Lorcana user that happens to be
signed in on the same Supabase project passes layer 1 but fails
layer 2. There is **no public admin registration** and the admin
account list cannot be mutated from the public auth form.

Server guard: `apps/hub/src/server/admin/require-admin.ts`.
Every protected admin page starts with `const { admin, sb } =
await requireAdmin(path)`. Unauthenticated callers are redirected
to `/admin/login`; authenticated-but-not-admin callers are
redirected to `/admin/denied`. The `/admin/login`, `/admin/denied`
and `/admin/sign-out` routes themselves do not call `requireAdmin`
(they would redirect back to themselves).

## RBAC

Roles on `network_admin_users.role`:

- `owner` — unrestricted. Luke.
- `admin` — may approve actions, edit settings, assign tasks.
- `editor` — may draft content and manage tasks; cannot approve
  consequential AI actions.
- `viewer` — read-only.

The enum exists in Phase 0; UI gates based on role land as
features are implemented. Database-level RLS currently requires
`is_active = true` only, not a specific role; tighten with policy
updates when needed.

## Bootstrap first admin

Phase 0's migration includes an `on conflict do update` INSERT
that attempts to promote the auth user for Luke's email to
`owner`. If that `auth.users` row doesn't exist yet (first run,
no prior consumer login), the INSERT no-ops safely.

Flow to onboard the first admin on a fresh database:

1. Apply the Phase 0 migration.
2. From Supabase SQL editor, run:
   ```sql
   insert into public.network_admin_users
     (auth_user_id, email, display_name, role, is_active)
   values (
     (select id from auth.users where lower(email) = 'you@example.com' limit 1),
     'you@example.com', 'You', 'owner', true
   )
   on conflict (auth_user_id) do update
     set role = 'owner', is_active = true, updated_at = now();
   ```
3. Sign in at `/admin/login`.

If the shared Supabase auth user doesn't exist yet, create it via
Supabase dashboard → Authentication → Users first (invitation
flow), then run step 2.

## Integrations model

`network_integrations` carries one row per (provider, site)
combination. The row stores:

- status (`not_connected` → `connected` / `error`)
- `credential_env` — the name of the environment variable the
  server should read for secrets. **Never the secret itself.**
- `config` jsonb for non-secret configuration (project IDs,
  property IDs, URLs).
- `last_success_at`, `last_attempt_at`, `error_summary`.

Service-role calls read secrets from `process.env[credential_env]`
at request time; they never land in the database.

## Data source registry

`network_data_sources` is a small lookup of codes (`gsc`, `ga4`,
`ebay_epn`, `internal_db`, `manual`, `ai`, `derived`, …). Every
metric, task, alert and approval row references a source code so
later AI can reason about provenance.

## Tasks + alerts + approvals

- **Tasks** are "do this now" units of work. Created by humans,
  derived from alerts, or proposed by AI through approvals.
- **Alerts** are automatically detected signals. An alert may
  generate a task via `network_alerts.task_id`.
- **Approvals** gate consequential AI or system actions. Status
  must reach `approved` before the executor runs the payload.
  Payload lives in jsonb so the model supports article drafts,
  bulk metadata patches, outbound posts, etc. without further
  schema work.

## Audit log

`network_log_audit(action, entity_type, entity_id, site_id,
old_value, new_value, actor_type, source, metadata)` is the single
helper for consequential-action logging. Use it from server actions
whenever a write mutates OS state. Reading is admin-only.

## Rules for accessing production site DBs

1. Reads only, by default. Writes require explicit human approval
   via `network_approvals`.
2. Use the shared anon key with the appropriate RLS context, not
   service-role, unless the operation genuinely needs elevated
   access.
3. Isolate the ingest / reader logic from UI render paths so a slow
   or failing site DB cannot block the admin shell.

## Public hygiene

- `/admin/*` is `noindex, nofollow` at both the layout metadata and
  the page level.
- `robots.txt` on the public hub disallows `/admin`.
- `sitemap.xml` does not list any admin route.
- No link from any public page points at `/admin`.

The hidden URL is not a security property; authentication is.

## What Phase 0 explicitly does NOT include

- Google Search Console ingestion.
- Google Analytics ingestion.
- Bing / IndexNow / X / eBay EPN connectors.
- Any article generation or publishing.
- Any automatic external action.
- A BigQuery warehouse.

Those come next, in the order the Phase 0 report recommends.
