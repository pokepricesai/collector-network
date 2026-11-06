# CN-STOCK-02 · scheduled stock-alert pilot

**Status:** engineering complete; awaiting two operator actions (migration apply + Discord webhook env var) before the 48h pilot activates.

## 1. Completed components

- **Schema** — `supabase/migrations/20261107050000_cn_stock_02_engine.sql`
  - `cn_stock_watchlist` — one row per monitored listing; carries confirmed state + consecutive counters
  - `cn_stock_observations` — append-only raw check log (30-day retention recommended)
  - `cn_stock_events` — confirmed state-change events; `UNIQUE (transition_key)` enforces idempotency across concurrent workers
  - `cn_stock_outbox` — durable Discord delivery queue; `UNIQUE (idempotency_key)` prevents duplicate enqueue; status enum includes `timeout_ambiguous`
  - Admin-only RLS on all four tables
- **State machine** — `apps/hub/src/server/stock/stateMachine.ts`
  - Pure function `decide(watchlist_row, observation) → { watchlist_patch, emit_event, rationale }`
  - Enforces all 10 rules from the brief: first-observation baseline, require 2 confirming `in_stock` before emitting a restock, preserve state on `unknown`/`blocked`, reset streak counters on interruption, preorder is distinct and never a restock, repeated observations never duplicate events.
  - Transition key is `${watchlist_id}:${from}->${to}:${minute_bucket}` so concurrent workers collide on the UNIQUE constraint rather than double-emit.
- **Probe worker** — `apps/hub/src/server/stock/probe.ts`
  - Pulls due watchlist rows, runs robots gate → fetch → classify → state machine.
  - `robots.txt` is **fail-closed** on uncertainty (any non-200/404/410 → block for this cycle, retry next).
  - Per-host politeness via `HostGate` (default 3 s).
  - Writes to `network_job_runs` so `/admin/jobs` shows each fire.
- **Delivery worker** — `apps/hub/src/server/stock/deliver.ts`
  - Drains outbox with compare-and-swap lock so two concurrent workers can't double-send.
  - Honours Discord `Retry-After` on 429; exponential backoff `[1m, 2m, 5m, 15m, 60m]` otherwise.
  - Client-side timeout → `timeout_ambiguous` (NOT retried — the brief's ambiguous-send rule).
  - Retry budget exhaustion → `failed_permanent`.
  - Webhook env var missing → `pending` with 5-minute soft retry (doesn't burn attempts).
- **Discord payload** — `apps/hub/src/server/stock/discord.ts`
  - Matches the brief's format exactly: game, product, retailer, price/currency, "Back in stock", UTC timestamp, direct product link.
  - Webhook URL is read from env on every call, never logged, never stored in the DB.
- **Cron handlers**
  - `GET /api/cron/stock-probe` — fires `*/15 * * * *` UTC
  - `GET /api/cron/stock-deliver` — fires `*/3 * * * *` UTC
  - Both **gated OFF** by `STOCK_PROBE_ENABLED !== '1'` and return a no-op summary until the operator flips it to `1`.

## 2. Exact files + migrations

New files on branch `cn-stock-02-engine`:

```
supabase/migrations/20261107050000_cn_stock_02_engine.sql     (schema + RLS)
apps/hub/src/server/stock/types.ts                            (shared TS types)
apps/hub/src/server/stock/stateMachine.ts                     (pure state machine)
apps/hub/src/server/stock/extract.ts                          (JSON-LD/meta/microdata classifier)
apps/hub/src/server/stock/fetch.ts                            (bounded GET)
apps/hub/src/server/stock/robots.ts                           (robots.txt gate, fail-closed)
apps/hub/src/server/stock/probe.ts                            (probe worker)
apps/hub/src/server/stock/deliver.ts                          (outbox drain worker)
apps/hub/src/server/stock/discord.ts                          (webhook payload + send)
apps/hub/src/app/api/cron/stock-probe/route.ts                (cron handler, flag-gated)
apps/hub/src/app/api/cron/stock-deliver/route.ts              (cron handler, flag-gated)
apps/hub/src/server/stock/__tests__/stateMachine.test.ts      (17 state-machine scenarios)
apps/hub/src/server/stock/__tests__/deliver.test.ts           (9 outbox / Discord scenarios)
apps/hub/src/server/stock/__tests__/integration.test.ts       (9 end-to-end pglite scenarios)
```

Modified:

```
apps/hub/vercel.json                       (+2 cron entries, both flag-gated at runtime)
```

Unified operator-paste SQL: `C:\Users\lukep\AppData\Local\Temp\cn-stock-02-migration\apply.sql` (244 lines, idempotent)

## 3. Tests + actual results

```
pnpm --filter hub vitest run src/server/stock/__tests__/
✓ stateMachine.test.ts   17 tests passed
✓ deliver.test.ts         9 tests passed
✓ integration.test.ts     9 tests passed
Test Files  3 passed (3)
     Tests  35 passed (35)
```

Scenario coverage vs the brief's Phase 6 list:

| Brief scenario | Test | Result |
|---|---|---|
| Initial baseline creates no alert | stateMachine · Rule 1 · first in/out/preorder | ✓ |
| Confirmed out → in creates one event | integration · 'out → in with two consecutive in_stock' | ✓ |
| Repeated in_stock creates zero additional events | stateMachine · Rule 7 | ✓ |
| Unknown does not alter confirmed stock | stateMachine · Rule 5 + integration | ✓ |
| Preorder does not count as a restock | stateMachine · Rule 6 + integration | ✓ |
| Wrong product variant cannot generate alert | integration · 'identity mismatch swallowed as unknown' | ✓ |
| Failed checks preserve confirmed state | integration · 'HTTP 500 preserves confirmed state' | ✓ |
| Duplicate/concurrent workers do not duplicate events | integration · 'duplicate transition_key insert rejected' | ✓ |
| Discord temporary failure retries appropriately | deliver · retryable paths (429 + 5xx + budget exhaustion) | ✓ |
| Discord timeout has documented ambiguous-send behaviour | deliver · 'client timeout does NOT retry' | ✓ |
| Delivery outbox survives restart | integration · 'outbox row survives workflow restart' | ✓ |
| Rate limits / permissions respected | deliver · '429 Retry-After honoured' + robots fail-closed | ✓ |

`pnpm --filter hub typecheck` — passes clean.

## 4. Retailers + products configured

**Not yet seeded** — this ships a verified engine, not the initial watchlist. The operator seeds 3–6 real listings via one of:

- `INSERT INTO cn_stock_watchlist (...) VALUES (...)` run through Supabase SQL editor
- Direct POST to a future admin endpoint (CN-STOCK-02 polish; not in this PR)

Candidates from CN-STOCK-01's live benchmark:

| Retailer | URL | Extraction confirmed | Ready |
|---|---|---|---|
| game_nerdz | `https://www.gamenerdz.com/magic-the-gathering-streets-of-new-capenna-set-booster-box` | JSON-LD, USD 219.97 | **yes** |
| game_nerdz | `https://www.gamenerdz.com/magic-the-gathering-throne-of-eldraine-booster-box` | JSON-LD, USD 219.97 | **yes** |
| miniature_market | `https://www.miniaturemarket.com/magic-the-gathering-tales-of-middle-earth-set-booster-pack-wocd1523-pack.html` | microdata, in_stock | **yes** |

Add 3 more listings from the same retailers (alternative MTG booster boxes, Pokémon sealed, etc.) to hit the 3–6 pilot target — the extraction path is proven on these hosts.

## 5. Estimated requests + operating cost

**Pilot shape:** 6 listings, 15-minute cadence, probe + delivery crons.

| Metric | Measured / projected | Notes |
|---|---|---|
| Probe fires / day | 96 (`*/15`) | Flag-gated cron |
| Delivery fires / day | 480 (`*/3`) | No-ops when outbox empty; cost ≈ Vercel function invocation only |
| Product GETs / day | 6 × 96 = **576** | Per host: ≤ 192 (3 listings × 96 fires) — well under any rate-limit concern |
| robots.txt GETs / day | ~5 | Cached 1 hour; one re-fetch per host per hour |
| Supabase rows written / day | ≤ 576 observations + ≤ a few events + ≤ a few outbox | 30-day retention on observations table keeps it bounded |
| Bytes ingress / day | 576 × ~250 KB mean = **~144 MB/day** | **~4.3 GB/month** at current pilot size |
| Vercel function invocations / month | 96 × 30 + 480 × 30 = **17,280** | **unverified** against current plan allowance; expected to fit standard Pro included quota |
| Supabase storage / month | < 10 MB | Negligible |

**Cost expectation:** £0 incremental. All within existing Supabase + Vercel plan capacity based on measured values. The "unverified" above reflects that I did not inspect the current usage meters; recommend operator glance at the Vercel bandwidth meter before enabling. If measured usage ever approaches 50% of monthly bandwidth, drop `STOCK_PROBE_LISTING_CAP` or increase `check_interval_minutes`.

**Scale ceiling before £100/month is a concern:** at 50 listings × 5-min cadence (288 fires/day), bandwidth projects to ~43 GB/month, still comfortably inside most plans. No upgrade needed for the brief's eventual target scale.

## 6. Discord delivery test result

**Not yet executed** — webhook env var is pending operator action (see §8). End-to-end delivery is validated in tests via `discord.sendDiscord()` mocked at the fetch boundary; the first live test fires after the env var is set. Expected first-send verification:

1. Operator sets `STOCK_PROBE_DISCORD_WEBHOOK` + `STOCK_PROBE_ENABLED=1` (§8).
2. Operator seeds one listing with a deliberately-contrived `last_confirmed_state='out_of_stock'` + the current live `in_stock` page.
3. First 15-minute probe cycle observes `in_stock` → tentative, no event yet.
4. Second 15-minute cycle observes `in_stock` → event + outbox row.
5. Next 3-minute delivery cycle posts to the test channel.
6. Operator confirms the message appeared with the expected format (RESTOCK DETECTED, exact product, price in USD/GBP, direct URL).

Elapsed time from enable → first message: **≤ 33 minutes** (15 + 15 + 3).

## 7. Production deployment status

**Branch:** `cn-stock-02-engine` on `pokepricesai/collector-network`. PR open with the full engineering above. **Not merged yet.**

**Safe to merge immediately** — the two cron handlers both return `{ ok: true, skipped: true }` when `STOCK_PROBE_ENABLED !== '1'`. Merging the PR without flipping the flag has zero behaviour change: the schema migration is a separate operator action (idempotent script), the cron registration is dormant, and no fetch / Discord request fires.

**Ordered deployment sequence:**
1. **Operator applies** `C:\Users\lukep\AppData\Local\Temp\cn-stock-02-migration\apply.sql` via Supabase SQL editor.
2. **Operator sets** the two env vars on the Hub Vercel project (see §8).
3. **Operator seeds** 3–6 real listings in `cn_stock_watchlist` (SQL below under §9).
4. **Operator sets** `STOCK_PROBE_ENABLED=1` on the Hub Vercel project.
5. Merge the PR. Hub auto-deploys from `main`.
6. First probe cycle fires on the next `*/15` cron tick.

If the migration goes first but the flag stays off, the pipeline is fully inert — nothing happens. If the migration is deferred and the flag is flipped on, the probe cron returns HTTP 500 (`cn_stock_watchlist` doesn't exist); operator sees it on `/admin/jobs` and reverses the flag.

## 8. Operator actions required

**Two gated actions; neither can be automated from inside the engine:**

### A. Apply the migration

Open Supabase SQL editor for the production project, paste the entire contents of `C:\Users\lukep\AppData\Local\Temp\cn-stock-02-migration\apply.sql`, run. Verification queries at the bottom of the file confirm the four tables, their RLS policies, and that no rows are affected. Script is idempotent — safe to re-run.

### B. Configure the private Discord webhook

1. Open the Collector Network private Discord server.
2. Pick (or create) a **private** test channel — e.g. `#stock-alert-test`. Make sure non-admin members cannot read it until the pilot is stable.
3. In the channel settings → **Integrations** → **Webhooks** → **New Webhook**. Name it `CN Stock Pilot`. Copy the webhook URL.
4. On the Hub Vercel project (`collector-network`):
   ```
   vercel env add STOCK_PROBE_DISCORD_WEBHOOK production
   # paste the webhook URL when prompted; never into chat or commits
   vercel env add STOCK_PROBE_ENABLED production
   # set to the literal string: 1
   ```
   Or add via the Vercel dashboard → Settings → Environment Variables.

No other secrets. No new paid service. No new API account.

## 9. How to start, pause, stop monitoring

**Start the whole pipeline:**
```
vercel env add STOCK_PROBE_ENABLED production
  # value: 1
```

**Pause (keep data + outbox intact; just stop issuing requests and deliveries):**
```
vercel env rm STOCK_PROBE_ENABLED production
  # OR set to literal "0"
```
Both cron handlers immediately return `{ok: true, skipped: true}` on the next fire.

**Stop monitoring one specific listing without halting the whole pipeline:**
```sql
UPDATE cn_stock_watchlist SET monitoring_enabled = false WHERE id = '<uuid>';
```

**Completely reset the pilot (pilot ended, start fresh):**
```sql
DELETE FROM cn_stock_outbox;
DELETE FROM cn_stock_events;
DELETE FROM cn_stock_observations;
DELETE FROM cn_stock_watchlist;
```
The migration's schema remains intact; the engine is ready to be re-enabled whenever.

**Seed listings** (first 3 are the CN-STOCK-01 verified URLs; add more as needed):
```sql
INSERT INTO cn_stock_watchlist
  (retailer, country, game, product_name, variant, url, check_interval_minutes)
VALUES
  ('game_nerdz', 'US', 'mtg',
   'Magic: The Gathering Streets of New Capenna Set Booster Box', 'booster_box',
   'https://www.gamenerdz.com/magic-the-gathering-streets-of-new-capenna-set-booster-box', 15),
  ('game_nerdz', 'US', 'mtg',
   'Magic: The Gathering Throne of Eldraine Booster Box', 'booster_box',
   'https://www.gamenerdz.com/magic-the-gathering-throne-of-eldraine-booster-box', 15),
  ('miniature_market', 'US', 'mtg',
   'Magic the Gathering Tales of Middle Earth Set Booster Pack', 'booster_pack',
   'https://www.miniaturemarket.com/magic-the-gathering-tales-of-middle-earth-set-booster-pack-wocd1523-pack.html', 15);
```

Adjust `check_interval_minutes` per listing if some hosts are slower.

## 10. 48-hour pilot success criteria

The pilot runs for 48 hours starting when `STOCK_PROBE_ENABLED=1` is set. Success means **ALL** of the following hold:

1. **Scheduled checks execute reliably.** `/admin/jobs` shows `stock.probe` and `stock.deliver` run entries with `status=success` on ≥ 90% of the expected fires (allow 10% operational slack for retailer slowness).
2. **Stock observations remain accurate.** No `in_stock` observation in `cn_stock_observations` with `identity_match=false` that advances to an event. (Query: `SELECT COUNT(*) FROM cn_stock_events e JOIN cn_stock_observations o ON o.watchlist_id = e.watchlist_id WHERE o.identity_match = false` → expect 0.)
3. **No false restock alerts.** Operator spot-checks every event's product_link and confirms the page actually shows the product as in-stock within 20 minutes of `detected_at`. Zero false positives acceptable.
4. **Failures do not corrupt state.** `cn_stock_watchlist.consecutive_fail_count > 0` is permitted; `cn_stock_watchlist.last_confirmed_state` never flips because of a failure.
5. **Discord test delivery works.** At least one message lands in the private test channel over the 48h (either from a real transition or a controlled test — see below).
6. **Operating cost within capacity.** Vercel bandwidth usage over the pilot < 1 GB; Supabase row count at end of pilot < 3,000 observations. No upgrades required.
7. **System recovers from errors without manual intervention.** If one retailer blocks for a few hours, the engine logs it via `consecutive_blocked_count` and resumes when access returns — no operator action required.

If no genuine restock happens during the 48h, the operator may run a **controlled test transition** to validate the end-to-end path:
```sql
-- Force a watchlist row into out_of_stock baseline, so the next real
-- in_stock observation will be a qualifying restock.
UPDATE cn_stock_watchlist
   SET last_confirmed_state = 'out_of_stock',
       consecutive_in_stock_count = 0,
       last_state_changed_at = now()
 WHERE url = '<a currently-in-stock URL from the watchlist>';
```
Expected outcome: next probe cycle observes `in_stock` (tentative), the one after confirms, event emitted, delivery cron posts to the test channel within 18 minutes. Label the resulting Discord message mentally as "controlled test, not organic" when reviewing.

---

## Appendix A — rollback

Emergency pause (no data loss):
```
vercel env rm STOCK_PROBE_ENABLED production
```

Remove all engine state but keep schema:
```sql
DELETE FROM cn_stock_outbox;
DELETE FROM cn_stock_events;
DELETE FROM cn_stock_observations;
DELETE FROM cn_stock_watchlist;
```

Remove the schema entirely (last resort):
```sql
DROP TABLE IF EXISTS public.cn_stock_outbox CASCADE;
DROP TABLE IF EXISTS public.cn_stock_events CASCADE;
DROP TABLE IF EXISTS public.cn_stock_observations CASCADE;
DROP TABLE IF EXISTS public.cn_stock_watchlist CASCADE;
DROP FUNCTION IF EXISTS public.cn_stock_touch_updated_at();
```

## Appendix B — extension points (deliberately NOT in this milestone)

- Shopify `/products/HANDLE.json` secondary extraction path for stores that emit no Product JSON-LD (noted from CN-STOCK-01 Total Cards case).
- Admin dashboard at `/admin/stock/` listing watchlist + recent events + outbox state. Current operator surface is `/admin/jobs` (fire history) + direct SQL into Supabase for watchlist/events/outbox.
- Multi-target Discord routing (`discord:ops`, `discord:beta`, etc.) via additional env vars. Infrastructure already supports it (`target` column in outbox).
- Public stock-alert subscription, premium tier, payment — explicitly out of scope per the brief.
