# PP-TCG-CUTOVER-PREP-02 — Final Pilot Verification

Public TCGGraph pricing/images/history remain **OFF**. All four env flags unset. All 18 pilot slugs have every feature disabled. 0 TCGGraph credits spent on changes.

## PASS / FAIL · 6-item summary

| # | Item | Result |
|---|---|---|
| 1 | **683 vs 653 reconciled** | ✅ `683` was an incorrect number from earlier memos. Authoritative catalogue is **653 unique set codes**. Zero sets are being skipped by the discover cron. |
| 2 | **Fully completed ingestion cycle verified** | ✅ Yesterday's cycle (`cycle_date=2026-10-18`) processed all 653 observed codes — final chunk at `2026-10-19T00:00:03Z` marked `cycle_complete=true` (20 min across midnight; the day-boundary fix held). Authoritative credit draw = TCGGraph `x-credits-remaining` delta. Today's cycle running cleanly: 250/653 processed by 10:20 UTC. **One caveat below.** |
| 3 | **Targeted ISR revalidation** | ✅ New admin endpoint `/api/admin/pilot/revalidate` revalidates only the explicit `/set/.../card/...` paths for the supplied slugs. Admin auth + bounded body + no sitewide purge. |
| 4 | **Protected pilot test coverage** | ✅ 6 new vitest cases in `src/lib/providerData/__tests__/pilotCohort.test.ts`. Covers the four gate-combination corners: bulk_safe + normal (A), market_only + variant printing with graded SUPPRESSED (B), bulk_safe + pilot OFF both ways (C), market_only + flag OFF (D). All 65 providerData tests pass. |
| 5 | **No visitor-triggered TCGGraph calls** | ✅ Zero `api.tcggraph` / `tcggraph.com` references in pokeprices-web. All TCGGraph fetches live in the hub cron routes behind `assertCronCaller`. Public visitors read only Supabase. |
| 6 | **Production flags + 18 pilot switches off** | ✅ No `PP_USE_TCGGRAPH_*` or `PP_USE_CURRENCY_SELECTOR` in Vercel production env. All 18 pilot rows have `prices_enabled=false`, `images_enabled=false`, `history_enabled=false`. |

---

## Detail — Items 1 & 2

### 1 · The 683 vs 653 reconciliation

The "683 sets" claim first appeared in MIGRATE-05 memo and propagated through subsequent docs. The authoritative values from live production:

| Source | Rows | Unique codes | Unique (code, lang) |
|---|--:|--:|--:|
| `pokemon_tcg_sets_observed` | 1,306 | **653** | 653 |
| `pokemon_tcg_provider_cards` (distinct `tcg_set_code`) | — | **653** | — |

`1,306 observed = 653 unique (code, lang) × 2 observations (10-18 and 10-19).` The discover cron emits one row per observation window. Zero observed codes are missing from `provider_cards`; zero orphans.

The "30-set delta" is a comparison artefact between an old estimate and the real catalogue — no sets are being skipped.

### 2 · Yesterday's cycle completion — honest reporting

- Yesterday's cycle (`cycle_date=2026-10-18`) started at 15:20 UTC after the TCGGRAPH_API_KEY fix
- 20 chunks fired on `*/20 * * * *` schedule
- Final chunk: `2026-10-19T00:00:03Z` processed 3 remaining sets and emitted `metadata.cycle_complete=true`
- Cursor advanced to `completed_for_day`, cycle_date rolled to 2026-10-19 on today's first fire
- Today's cycle is active, cursor at `cycle_sets_processed=250` at 10:20 UTC (fresh, same-day cycle)

**Caveat: 3,130 cards on 20 Japanese-only set codes still carry the initial `catalogue_version='2026-10-18-pp-tcg-migrate-01'`.** Diagnosis:

- These are codes like `xy6`, `sv3`, `sv9`, `sm9` where TCGGraph's `/v1/sets` endpoint only lists the EN variant (e.g. `xy6` → "Roaring Skies")
- The initial migrate-01 batch pre-populated BOTH EN and JA versions
- The chunk route reads from `pokemon_tcg_sets_observed`, which the discover cron populates from `/v1/sets`. For these codes it only sees EN.
- Chunk route refreshes EN cards; JA cards stay on the initial version.

**Not a pilot blocker** — the 18 pilot cards are all EN modern or JP with distinct JP codes (not shared). But the operator should know: 3,130 Japanese cards' prices are stale (identity preserved). Follow-up ticket to extend discovery or dual-language ingest if those sets ever enter pilot. Does NOT affect approval, QA eligibility, or public display (public is off for all).

### Credit totals (authoritative)

| Window | Credits (observed delta) | Chunks |
|---|--:|--:|
| 2026-10-18 cycle | 1,680+ | 21 |
| 2026-10-19 ongoing | 922 (so far) | ~10 |
| **x-credits-remaining right now** | **125,132 of 150,000** |

16.6% consumed through 2.5 days of continuous operation. Monthly projection stays at ~59% of plan.

---

## Detail — Items 3-6

### 3 · Targeted ISR revalidation

New route `src/app/api/admin/pilot/revalidate/route.ts`:

```
POST /api/admin/pilot/revalidate
Authorization: Bearer <admin JWT>
Content-Type: application/json

{ "pp_card_slugs": ["5732721", "5732710"] }
```

- Resolves each `card_slug` to its public URL via the `cards` table
- Calls `revalidatePath("/set/<encoded set>/card/<encoded cardSlug>")` for each
- Bounded at 50 slugs per call (bigger set = multiple calls)
- Admin-authenticated via existing `requireAdmin()` (Bearer token + `ADMIN_ALLOWED_EMAILS`)
- Non-sitewide: only the explicit URLs are invalidated

### 4 · Protected test coverage

`src/lib/providerData/__tests__/pilotCohort.test.ts` — 6 cases:

| Case | Setup | Expected |
|---|---|---|
| A: bulk_safe normal + pilot ON + flag ON | Sinistea #89 fixture | graded + market both returned |
| B: market_only variant + pilot ON + flag ON | Aerodactyl 1st Ed #16 (hypothetical) | market returned, **graded SUPPRESSED** |
| C.1: pilot OFF + flag ON | bulk_safe fixture, no pilot row | everything blocked |
| C.2: pilot ON + flag OFF | bulk_safe fixture, no env flag | everything blocked |
| D: market_only + pilot ON + flag OFF | hypothetical variant fixture | everything blocked |
| foil bulk_safe + prices ON only | Keldeo ex #30 fixture, images disabled | prices returned, image null |

All 65 providerData tests pass. Protected invariant: graded aggregate NEVER leaks onto variant printings.

### 5 · No visitor-triggered TCGGraph calls

Static-code audit:

```
grep "api.tcggraph|tcggraph.com" pokeprices-web/src → 0 matches
grep "api.tcggraph|tcggraph.com" apps/hub/src       → 4 matches
```

The 4 hub matches are all cron routes:
- `/api/cron/pp-tcg-ingest-chunk`
- `/api/cron/pp-tcg-history-sampler`
- `/api/cron/pp-tcg-ingest-health`
- `/api/cron/pp-tcg-discover`

Each gated by `assertCronCaller(req)` (CRON_SECRET bearer). No public endpoint fetches TCGGraph. The USD/EUR cookie flip triggers a `router.refresh()` which re-renders the page server-side using **cached FX from Supabase** — no TCGGraph call.

### 6 · Production flags confirmed off

**Vercel env (via `vercel env ls production`)**:
```
PP_USE_TCGGRAPH_PRICES    → NOT SET
PP_USE_TCGGRAPH_IMAGES    → NOT SET
PP_USE_TCGGRAPH_HISTORY   → NOT SET
PP_USE_CURRENCY_SELECTOR  → NOT SET
```

**Pilot cohort state** (18 rows, all queried just now):
- `prices_enabled`: FALSE for all 18
- `images_enabled`: FALSE for all 18
- `history_enabled`: FALSE for all 18
- `deactivated_at`: NULL for all 18 (rows active but no feature engaged)
- Any one feature enabled: 0

---

## Pilot activation procedure (post-licensing)

Operator-safe, per-slug, independently reversible. Executed in strict order:

### Step 1 — Enable the DB-side flag for ONE feature on ONE slug

```sql
-- Example: activate IMAGES only for Sinistea #89
UPDATE pokemon_tcg_pilot_cohort
   SET images_enabled = TRUE,
       activated_at   = NOW()
 WHERE pp_card_slug  = '5732721';
```

**No public effect yet** — the env flag is still off.

### Step 2 — Flip the matching env flag in Vercel production

```bash
# IMAGES: only slugs with images_enabled=true will serve TCGGraph images
echo "1" | vercel env add PP_USE_TCGGRAPH_IMAGES production
```

Any Vercel deploy must have the flag before it takes effect; use `vercel deploy --prod` or wait for the next automatic deploy.

### Step 3 — Invalidate the ISR cache for that card

```bash
curl -X POST https://www.pokeprices.io/api/admin/pilot/revalidate \
  -H "Authorization: Bearer $ADMIN_SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"pp_card_slugs": ["5732721"]}'
```

Next visitor-driven render re-reads the pilot/flag state → serves TCGGraph image. ONLY that card URL is invalidated.

### Step 4 — Verify

- Visit the live card URL in a fresh browser session
- Confirm the image is served from `cards.tcggraph.io` (not `storage.googleapis.com/images.pricecharting.com`)
- Confirm prices are NOT changed (PP_USE_TCGGRAPH_PRICES still off)
- Check Vercel logs: no 500s on the card route

### Step 5 (expansion) — repeat for prices / history

```sql
UPDATE pokemon_tcg_pilot_cohort
   SET prices_enabled = TRUE
 WHERE pp_card_slug  = '5732721';
```
Then `vercel env add PP_USE_TCGGRAPH_PRICES production` and revalidate again.

### Rollback — any step, same mechanism

```sql
-- Rollback a single slug, any single feature
UPDATE pokemon_tcg_pilot_cohort
   SET prices_enabled = FALSE
 WHERE pp_card_slug  = '5732721';
```

OR unset the env flag:
```bash
vercel env rm PP_USE_TCGGRAPH_IMAGES production
```

Either path, THEN revalidate:
```bash
curl -X POST https://www.pokeprices.io/api/admin/pilot/revalidate \
  -H "Authorization: Bearer $ADMIN_SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"pp_card_slugs": ["5732721"]}'
```

Rollback is instant for the next render; worst-case the stale ISR window remains until the 24h TTL expires.

---

## Guard-rails upheld

| Guard | State |
|---|---|
| Public pricing / images / history / URLs / SEO | **unchanged** |
| Python PriceCharting scraper | **running** (`card_trends.as_of` = today) |
| All `PP_USE_TCGGRAPH_*` env flags | **unset** |
| `PP_USE_CURRENCY_SELECTOR` | **unset** |
| 18 pilot cohort switches | **all FALSE** |
| TCGGraph credits spent on changes | **0** |
| Hub tests | 46 pass |
| PP-web providerData + card tests | 65 + 25 = **90 pass** |
| Typechecks | both apps clean |

**Technical pilot mechanism complete. Awaiting operator licensing + rights clarification before Step 1 of activation.**
