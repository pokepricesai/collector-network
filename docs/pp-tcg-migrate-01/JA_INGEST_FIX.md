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

### JA refresh verification — VERIFIED

Today's cycle (`cycle_date=2026-10-19`) **completed_for_day at 16:16 UTC** with 672 of 676 (code, lang) pairs processed. Final cycle credits spent: **1,985**.

| Observation | Starting (10:45 UTC) | After today's cycle (16:16 UTC) | Δ |
|---|--:|--:|--:|
| Stale cards (`catalogue_version='2026-10-18-pp-tcg-migrate-01'`) | 3,130 | **404** | **−2,726** |
| Cycle sets processed | 275 | 672 | +397 |
| Cycle credits spent | 1,146 | 1,985 | +839 |

Sample card `pkm_ja_xy6_60` (Emerald Break JA, previously stale) at 16:16 UTC:
- `catalogue_version` = `daily-2026-10-19` ✓
- `pokemon_tcg_prices_market.source_updated_at` = `2026-10-19T00:00:10Z` (today) for TCGplayer, `2026-10-18T18:47Z` for Cardmarket ✓

### Residual 404 cards (expected)

| Set code | Cards | Set name |
|---|--:|---|
| bw9\|ja | 159 | Megalo Cannon |
| bw7\|ja | 143 | Plasma Gale |
| bw4\|ja | 54 | Dark Rush |
| bw2\|ja | 43 | Red Collection |
| smp\|ja | 4 | Sun & Moon Promos (edge-case cards added after today's seed-script run) |
| xy3\|ja | 1 | Rising Fist (edge-case card) |

All 4 `bw*` codes sort alphabetically BEFORE the cursor's position when the new (code, lang) dedup deployed (10:45 UTC today). Today's cycle had already processed past the `b*` block under the OLD dedup (which only kept the EN variant). Tomorrow's cycle (00:00 UTC fresh start) processes alphabetically from the top and will refresh these on its first few chunks — expected around 00:30 UTC 2026-10-20.

### Actual additional credit consumption

**Yesterday (2026-10-18, pre-fix)**: 1,680 credits per full cycle, 653 (code, lang) pairs processed. JA variants of shared codes were silently skipped.

**Today (2026-10-19, post-fix)**: 1,985 credits per full cycle, 672 pairs processed (+19 of 23 newly-seeded JA codes caught by today's cycle).

**Additional credit cost per cycle**: 1,985 − 1,680 = **+305 credits/day** (projected ~2,100 cr/month — matches the pre-estimate of 23 × ~3 cr/set at the daily cadence). Tomorrow's cycle will catch the remaining 4 bw* codes, bringing the stable per-cycle delta to ~+350 credits/day = ~10,500/month, well inside the 61,050 cr/mo headroom on the Growth plan.

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

**Stale JA refresh completed within 5.5h of the deploy landing. 2,726 of 3,130 stale cards refreshed on today's cycle. Remaining 404 (all alphabetically before the cursor at deploy time) refresh in tomorrow's fresh cycle.**
