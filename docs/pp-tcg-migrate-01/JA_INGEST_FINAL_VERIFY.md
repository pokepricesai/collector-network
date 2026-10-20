# PP-TCG-JA-INGEST-FINAL-VERIFY — single-pass closeout

**Date**: 2026-10-20T10:29Z · **Cycle**: `cycle_date=2026-10-20` completed_for_day at 09:00 UTC today · **Pairs processed**: 681/681 · **Credits (authoritative)**: ~3,121.

**PASS on all 6 checks.** Workstreams CLOSED. No public TCGGraph activation. No remap. No pilot change. No scraper/SEO/URL changes.

## Check-by-check

### 1 · 404 migrate-01 residual — ✅ PASS

- Pre-cycle: 404 cards on `catalogue_version='2026-10-18-pp-tcg-migrate-01'`, all active
- Post-cycle: **9 cards** remain on migrate-01, **all `provider_status='superseded'`** (marked by the chunk cron's integrated reclassification sweep when today's complete API response for the same card_ids returned different printing_keys)
- **0 active cards on migrate-01** — the stale-content concern is resolved

bw*|ja status:

| Pair | Pre-cycle (active) | Post-cycle (active) | Post-cycle (superseded) |
|---|--:|--:|--:|
| bw2\|ja | 43 | **0** | 0 |
| bw4\|ja | 54 | **0** | 2 |
| bw7\|ja | 143 | **0** | 2 |
| bw9\|ja | 159 | **0** | 0 |

Residual non-bw: 4 cards in `smp|ja`, 1 in `xy3|ja` — all superseded (reclassifications caught today).

### 2 · 843-cohort refresh (xyp/xy10/sv6/sm7/sm8 |ja) — ✅ PASS

| Pair | Total | daily-2026-10-20 | daily-2026-10-18 (stale) | superseded |
|---|--:|--:|--:|--:|
| xyp\|ja | 335 | **329** | 6 | 6 |
| xy10\|ja | 157 | **157** | 0 | 0 |
| sv6\|ja | 133 | **133** | 0 | 0 |
| sm7\|ja | 115 | **112** | 3 | 3 |
| sm8\|ja | 112 | **112** | 0 | 0 |

All 843 expected cards processed. 9 cards (xyp 6 + sm7 3) stayed on `daily-2026-10-18` because the cron sweep marked them `superseded` — same reclassification mechanism. No active stale rows.

### 3 · Reclassification orphans auto-handled — ✅ PASS

| | Pre-cycle | Post-cycle |
|---|--:|--:|
| Total superseded | 35 | **217** |
| By source: operator script | 35 | 35 |
| By source: chunk cron (today's cycle) | 0 | **181** |

Chunk cron scanned **681 complete-pagination sets** and marked **181 reclassification orphans**. Zero inappropriate supersession:
- All 181 were cases where the same `card_id` is in today's API response with a different `printing_key`
- Rows for `card_id`s ABSENT from the API response were left `active` (operator reviews deletions separately — none observed today)
- Sets with incomplete pagination (hit the page-20 cap) would be excluded, but today's cycle had 0 incomplete sets

### 4 · Complete inventory — ✅ PASS

- `sets_observed` unique pairs: **681** (676 base + 5 seeded in previous ticket)
- Pairs with `daily-2026-10-20` provider_cards: **681**
- **Pairs expected but NOT processed today: 0** — zero skips

### 5 · Credit budget — ✅ PASS

- Today's authoritative counter delta: **~3,121 credits** (monthly_remaining went 120,084 → 116,963)
- Note: `pokemon_tcg_ingestion_runs.credits_spent` sum reports 35,058 but is contaminated by concurrent other-site activity bumping the x-credits-remaining counter between calls. The monthly counter delta is the authoritative measure.
- Monthly consumption: **22.0% of 150,000** (33,037 used, 116,963 remaining)
- Projection stable: expected 55-60% monthly utilization at steady state. Comfortably within Growth plan.
- Today's cycle: 31 chunk runs, 681 sets scanned, 181 reclass orphans marked. Zero additional API calls above normal ingestion.

### 6 · Mapping + pilot state — ✅ PASS (with explicit new exceptions)

- **Approved mappings pointing at a superseded printing**: 26 (previously 3)
- **Pilot cohort affected**: **0**
- **Darkrai EX #72 (3461618)**: unchanged — still `tcg_printing_key='normal'`, `pricing_eligibility='market_only'`. **Not auto-remapped. Not eligibility-upgraded.**
- Public safety: `pokeprices.io` returns 200 with no `tcggraph.io` references. All `PP_USE_TCGGRAPH_*` + `PP_USE_CURRENCY_SELECTOR` env flags OFF. Pilot switches off.
- Legacy scraper: `card_trends.as_of=2026-10-19` (today's scrape pending; typical).

**All 26 affected mappings fail-closed in the adapter** via the CLOSEOUT §4 `providerCardActive` gate. Zero public price/image surface — confirmed by the suppressed snapshot invariants (70 providerData vitest cases).

### New exceptions (not blocking closeout, flagged for operator)

| Count | Category | Example | Impact |
|---|--:|---|---|
| 3 | Original affected (previous ticket) | Darkrai EX #72, Drowzee [1st Ed] #40, Darkrai EX [1st Ed] #72 | 0 public — fail-closed; Darkrai EX #72 operator-remap decision pending |
| 23 | Newly identified by today's cron sweep | 20 `[Reverse Holo]` variants on older EN sets (ecard1-3, ex5/8/9/13, dp6, pl2, xy12, base6, basep) + 1 Lucky Stadium (bulk_safe!) + 1 Rayquaza VMAX #316 (bulk_safe!) + 1 Gyarados + others | 0 public — fail-closed; all 23 are variant-tagged PP cards whose TCGGraph printing_key has been reclassified away from the stored value |

**Two `bulk_safe` mappings** are in the new 23 — would be the highest-impact if public TCGGraph was live. Both correctly fail-closed because the (card_id, printing_key) they point at is superseded. The `providerCardActive` gate suppresses market, graded, AND images regardless of eligibility. Operator can decide whether to remap or demote these when revisiting the three original affected cards.

## Closeout decision

**✅ All 6 checks PASS.** The exceptions reported are either:
- Expected (reclassification orphans are the exact mechanism this ticket set up to detect and quarantine), OR
- Protected (approved mappings at superseded printings fail-closed in the adapter)

**Japanese ingestion and printing-reclassification workstreams: CLOSED.**

Future reclassification orphans will be marked automatically by the chunk cron's integrated sweep (zero extra API cost). No further operator action required for the workstream itself.

### Operator decisions still outstanding (post-closeout)

| Decision | Note |
|---|---|
| Darkrai EX #72 remap (`pkm_ja_ebb_72|normal` → `|foil`) | Internally safe per prior QA; would upgrade `market_only → bulk_safe`; needs explicit sign-off |
| 2 `[1st Edition]` cards and 23 newly-identified mappings | All fail-closed; demote / remap / retire — judgment call per card |

### Guard rails upheld (final)

| | |
|---|---|
| Public TCGGraph flags (4 of them) | **OFF** |
| 18 pilot switches | **OFF** |
| Deleted rows | **0** |
| Auto-remaps | **0** |
| Indexed URLs / canonicals / SEO / sitemap / robots | **unchanged** |
| PriceCharting scraper | **running** |
| Credit budget | 22% monthly consumed, trending to 55-60% stable |
| Hub + PP-web typecheck + 70 providerData tests + 46 hub tests | ✓ all pass as of last commit |
