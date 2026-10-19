# PP-TCG-JA-INGEST-FIX — Interim verification (2026-10-19 17:30 UTC)

Checks that can be run before the 2026-10-20 cycle. No mutations, no TCGGraph API spend. No public changes.

## Six-check status

| # | Check | Result |
|---|---|---|
| 1 | `bw2|ja`, `bw4|ja`, `bw7|ja`, `bw9|ja` processed + 404 drops | **PENDING** — awaits 2026-10-20 00:00 UTC cycle |
| 2 | Residual on `migrate-01` version | **PARTIAL** — current snapshot below; final after cycle |
| 3 | 1,096 missing provider records — pagination / filtering / API completeness / churn | **COMPLETE** — see §3 |
| 4 | Overlap between 404 and 1,096 cohorts | **PASS** — see §4 |
| 5 | Approved + pilot mapping impact | **PASS** — see §5 |
| 6 | Actual credit consumption | **PARTIAL** — today's cycle 1,985; monthly ~24k; 2026-10-20 cycle PENDING |

---

## §3 · The 1,096 cohort — classified, not assumed

Not natural catalogue churn as a blanket statement. Two distinct subgroups:

### 3a · Seeding-gap (5 (code, lang) pairs, 843 cards — 76.9% of the 1,096)

| Pair | Total | Today | Y-day | Diagnosis |
|---|--:|--:|--:|---|
| `xyp|ja` | 329 | 0 | 329 | ALL cards on `daily-2026-10-18`; NOT processed today |
| `xy10|ja` | 157 | 0 | 157 | same |
| `sv6|ja` | 133 | 0 | 133 | same |
| `sm7|ja` | 112 | 0 | 112 | same |
| `sm8|ja` | 112 | 0 | 112 | same |

**Root cause**: These five pairs have provider_cards rows (from yesterday's cycle running them under the OLD dedup where it happened to pick JA for these shared codes), but **the JA variant is NOT in `pokemon_tcg_sets_observed`** (confirmed via query). The discover cron's `/v1/sets` only returns EN for shared codes; today's chunk route (with the new `(code, lang)` dedup) looks for pairs in sets_observed and these JA pairs simply aren't there.

The 2026-10-19 seed script (`pp-tcg-ja-ingest-fix-01-seed-observed.mjs`) only backfilled JA codes whose provider_cards were still on `catalogue_version='2026-10-18-pp-tcg-migrate-01'` — these 5 pairs had already been upserted to `daily-2026-10-18` by yesterday's cycle, so they didn't match the seed filter.

**Fix (NOT applied — awaiting operator approval)**: identical to the first JA seed, but filter by `catalogue_version='daily-2026-10-18'` AND exclusive-of-what's-already-in-sets_observed. Would add 5 observation rows. Cost: +15 credits/day (~450/mo). No mutations today per your instruction.

### 3b · Natural catalogue delta (48 (code, lang) pairs, 253 cards — 23.1% of the 1,096)

Example: `g23859|ja` has 541 total cards, 540 refreshed today, 1 still on `daily-2026-10-18`. Every pair in this subgroup follows the same pattern: today's `/v1/cards?set=X&language=Y` call returned FEWER cards than yesterday for that set.

Pagination check — **not the cause**:
- Chunk route caps at `page > 20` (break on page 21, i.e. max 2,000 cards per set)
- Largest set in the catalogue is **928 cards** (`g24567|ja`); top 10 range 516–928
- Zero sets near the pagination cap

Filtering check — the chunk route passes no card-level filter beyond `set` and `language`. No where-clause for rarity, printings, etc. The listCardsInSet function pages 100 at a time.

Cross-reference check:
- `base_card_id` populated on **3 of 1,096** stale cards (promo reprints linking to a base) — not a systemic signal
- `english_id` populated on **1,020 of 1,096** stale cards — expected for JA cards; not a stale-indicator

**Verdict for 3b**: TCGGraph's `/v1/cards` response for these sets returned 1-5 fewer cards today than yesterday. Possible causes without additional TCGGraph calls: (i) TCGGraph genuinely removed/renumbered specific cards from their response; (ii) a provider-side pagination boundary edge case where card #99 on page 2 shifted to page 3 and `hasMore` was false after page 2. Confirmable only with a credit-costing call against the specific sets' /v1/cards endpoint — deferred per your "no unnecessary spending" rule. Operator can decide if 253 cards (23 of 48 pairs each with 1-5 missing cards) warrants a diagnostic probe (~50 credits).

---

## §4 · Cohort overlap

**Zero card-level overlap** between the 404 (`migrate-01`) and 1,096 (`daily-2026-10-18`) cohorts. 0 shared `tcg_card_id`.

Two overlapping (set, lang) pairs: `bw2|ja` and `bw4|ja`. These sets each have cards split BETWEEN the two cohorts (bw2|ja: 97 one-day-old + 43 never-touched; bw4|ja: 93 one-day-old + 54 never-touched). The individual cards within each set are different physical cards.

---

## §5 · Approved + pilot mapping impact

Query: approved mappings (`review_status='approved'`) whose `tcg_card_id` is on the stale catalogue versions.

| | Count |
|---|--:|
| Approved mappings pointing at a stale `tcg_card_id` | **406** |
| ├ bulk_safe | 107 |
| ├ market_only | 298 |
| └ identity_only | 1 |
| **Of those, in the 18-card pilot cohort** | **0** |
| **Pilot rows with ANY feature enabled** | **0** |

**Public impact: zero.** All 18 pilot cohort rows have `prices_enabled=false AND images_enabled=false AND history_enabled=false`. All production env flags `PP_USE_TCGGRAPH_*` remain unset. Even if an approved mapping points at stale provider data, the public card page serves legacy `card_trends` for all 406 cards.

The 406 approved mappings' identity, image URLs, and provider_card rows are all intact — the "stale" issue is only that market/graded prices are 1 day old (daily-2026-10-18) or ~2 days old (migrate-01). When public TCGGraph is eventually activated for any of these cards, the daily cycle will have brought their data current by then; the stale window is incidental to pilot timing.

---

## §6 · Credit consumption snapshot

| | Value |
|---|--:|
| Today's cycle credits (authoritative, `cycle_credits_spent`) | **1,985** |
| TCGGraph `x-credits-remaining` after last chunk | **120,084** |
| Approximate total spent this calendar month | **~24,000 of 150,000 (16%)** |
| Monthly projection (post JA fix) | ~82-88k = **55-59% of plan** |
| Headroom | **~60k+ cr/mo** |

---

## PASS/FAIL summary

| # | Status | Note |
|---|---|---|
| 1 | PENDING | 2026-10-20 cycle |
| 2 | PARTIAL | 404 still outstanding; expected to drop tomorrow |
| 3 | FAIL (partial) | 843 of 1,096 is a seeding-gap bug (not churn). Fix identified; NOT applied. 253 remain churn-or-TCGGraph-API-edge; diagnostic deferred to save credits. |
| 4 | PASS | 0 card-level overlap |
| 5 | PASS | Zero pilot or public impact |
| 6 | PASS | Credit draw healthy; no plan risk |

**Genuinely needing correction**: the 5 (code, lang) pairs in §3a (xyp|ja, xy10|ja, sv6|ja, sm7|ja, sm8|ja) — 843 cards. Requires a second `sets_observed` seed. Fix identified; **not applied** per your instructions. Can be seeded with ~5 inserts and will be picked up on the next cycle at ~+15 cr/day.

Everything else is either expected timing (bw*|ja refresh pending), low-value diagnostic (253 scattered cards worth ~50 cr to probe), or confirmed zero-impact (pilot/public).

Saved. Awaiting your signal to re-run the full six-check pass against the 2026-10-20 cycle after ~09:00 UTC.
