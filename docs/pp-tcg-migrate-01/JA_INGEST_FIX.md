# PP-TCG-JA-INGEST-FIX — Completion report

Public TCGGraph pricing/images/history remain **OFF**. All 18 pilot switches remain FALSE. No URL / SEO / scraper changes.

## Root cause

TCGGraph publishes some set codes in BOTH English and Japanese catalogues using the same code:

| code | EN name | JA name |
|---|---|---|
| xy6 | Roaring Skies | Emerald Break |
| sv3 | Obsidian Flames | Ruler of the Black Flame |
| sv9 | Journey Together | Battle Partners |
| sm9 | — | Tag Bolt |
| … | … | … |

The daily chunk route `pokemon_tcg_sets_observed` dedup used `tcg_set_code` alone. For each such code, only the first-observed language variant made it into the processing list. The 2026-10-18 initial `migrate-01` seed populated BOTH EN and JA, so 3,130 JA cards across 23 codes were left on the initial `catalogue_version`.

## Fix

### Chunk route (`apps/hub/src/app/api/cron/pp-tcg-ingest-chunk/route.ts`)

Three focused changes:

1. **Dedup key is now `(tcg_set_code, tcg_language)`** — each catalogue is refreshed independently.
2. **Cursor resume uses BOTH `last_set_code` AND `last_language`** — a JA-only continuation after processing all EN variants works correctly.
3. **`lastLanguage` is advanced per set** alongside `lastSetCode` so cross-boundary resumes are deterministic.

`allDoneNow` compares against `uniqSets.length` which now counts PAIRS, so JA variants count toward daily completion.

### Backfill (`scripts/pp-tcg-ja-ingest-fix-01-seed-observed.mjs`)

Reads distinct `(code, 'ja', set_name)` tuples from `pokemon_tcg_provider_cards` with the initial catalogue version, inserts matching rows into `pokemon_tcg_sets_observed`. **23 JA observations seeded** (one-off, idempotent — the chunk route's in-memory dedup makes re-runs safe).

## Credit impact

- Additional work per full cycle: **23 extra JA sets × ~3 cr/set ≈ 70 extra credits/day**
- Monthly: ≈ **2,100 extra credits**
- Headroom on Growth plan: **61,050 cr/month** → the additional load uses **3.4% of remaining headroom**
- Budget: **unchanged, no plan upgrade required**

## Verification

### Pilot rollback end-to-end check

Executed just now against production Supabase:

| Step | State in `v_pokemon_tcg_pilot_active` for `pp_card_slug=5732721` |
|---|---|
| Before: `UPDATE SET images_enabled=TRUE` | `images_enabled=false` (initial) |
| After: `UPDATE SET images_enabled=TRUE` | **`images_enabled=true`** ✓ reflected immediately |
| After: `UPDATE SET images_enabled=FALSE` | **`images_enabled=false`** ✓ reverted |
| All 18 rows post-check | 0 features enabled across the whole cohort |

Combined with `POST /api/admin/pilot/revalidate` the next visitor-driven render reads the new state immediately — no 24h ISR wait.

### JA refresh verification

**Chunk route alphabetical order**: EN sets A-Z, then JA sets A-Z. Current cursor is at `last_set_code='ds' last_language='ja'`.

- JA codes alphabetically **after `ds`** (ll, mee, sh, sm*, sma, smp, sv*, xy*) — **~15 of 23 refresh in today's cycle** on the next fires
- JA codes alphabetically **before `ds`** (bw2, bw4, bw7, bw9) — **4 of 23 refresh in tomorrow's cycle** (starts fresh at midnight UTC)

Expected total completion: within 24 hours of this deploy. A monitor is watching `catalogue_version='2026-10-18-pp-tcg-migrate-01'` row count to drop toward zero as cycles process them.

---

## Environment-variable change requires a redeploy

**Vercel platform behaviour** (documented explicitly because this bit tripped CUTOVER-PREP-01's ingest):

> Changes to environment variables set via `vercel env add` or the dashboard **do NOT take effect on already-deployed functions**. The new value is only loaded for functions in a build that runs after the env change.

For pilot activation, the operator sequence MUST include an explicit redeploy between env change and verification:

```bash
# 1. DB-side feature flag on
UPDATE pokemon_tcg_pilot_cohort
   SET images_enabled = TRUE, activated_at = NOW()
 WHERE pp_card_slug = '5732721';

# 2. Env flag added
echo "1" | vercel env add PP_USE_TCGGRAPH_IMAGES production

# 3. REDEPLOY — required before the env change is live
vercel deploy --prod                     # or any git push to main

# 4. Targeted ISR invalidation (post-redeploy)
curl -X POST https://www.pokeprices.io/api/admin/pilot/revalidate \
  -H "Authorization: Bearer $ADMIN_SUPABASE_JWT" \
  -H "Content-Type: application/json" \
  -d '{"pp_card_slugs": ["5732721"]}'

# 5. Verify in a fresh browser session
```

For rollback, step 3 **also applies when removing an env flag**:

```bash
vercel env rm PP_USE_TCGGRAPH_IMAGES production
vercel deploy --prod                     # mandatory
curl -X POST https://www.pokeprices.io/api/admin/pilot/revalidate ...
```

**Faster rollback path (no redeploy needed)**: toggle the DB-side flag off instead of removing the env var. The adapter checks both; disabling the per-slug flag is immediate.

```bash
# Instant rollback for one slug (no redeploy):
UPDATE pokemon_tcg_pilot_cohort SET images_enabled = FALSE WHERE pp_card_slug = '5732721';
# then revalidate the specific card URL
```

---

## Guard rails upheld

| Guard | State |
|---|---|
| Public pricing / images / history / URLs / SEO | **unchanged** |
| Python PriceCharting scraper | **running** (card_trends.as_of = today) |
| All `PP_USE_TCGGRAPH_*` env flags | **unset** |
| 18 pilot cohort switches | **all FALSE** |
| TCGGraph credits spent on changes | **0 beyond normal ingest** |
| Hub typecheck | ✓ clean |
| 90 PP-web + 46 hub tests | ✓ pass |

**Stale JA refresh will complete within 24h of the deploy landing. Deploy pushed, monitor watching the stale count.**
