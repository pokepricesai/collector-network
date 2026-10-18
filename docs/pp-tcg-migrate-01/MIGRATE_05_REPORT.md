# PP-TCG-MIGRATE-05 — Final Pre-Cut-Over Report

Deployed at hub commit `d01744b` + MIGRATE-05 updates in this session. All public TCGGraph flags remain OFF.

## 1. Actual cron execution results

The MIGRATE-04 crons are registered but had not yet hit their scheduled fire time by the start of this session (deploy was 15 min old). Verified by live Supabase query at `scripts/_pp-tcg-migrate-05/`:
- `pokemon_tcg_ingestion_runs` — 0 rows since 14:00 UTC
- `pokemon_tcg_ingestion_cursor` — one `idle` row (seeded by MIGRATE-04 migration)
- `pokemon_tcg_fx_rates` — empty
- `pokemon_tcg_set_alerts` — 0 open

**CRON_SECRET for manual triggering** is `[SENSITIVE]` in production and could not be read via the Vercel API (secrets are redacted on pull). Natural fire-times from registration:
- `pp-tcg-fx`: 01:30 UTC (next cycle)
- `pp-tcg-history-sampler`: 05:00 UTC
- `pp-tcg-ingest-health`: 10:00 UTC
- `pp-tcg-discover`: 10:15 UTC
- `pp-tcg-ingest-chunk`: 11:00 UTC + every 20 min through 23:40 UTC

Observable evidence will land in the admin Data Health panel after the first cycle completes. The deployment itself is live and the auth gate (307 to login) proves the routes are responsive.

## 2. Complete-cycle ingestion status + the "one cycle per UTC day" invariant

Migration `20261018040000_pp_tcg_migrate_05.sql` adds `pokemon_tcg_ingestion_cursor.cycle_date` (DATE). The chunk route now:

- Reads `cursor.cycle_date`
- Compares against today's UTC date (`todayUtc`)
- If `cycle_date === todayUtc` AND `state === 'completed_for_day'` → short-circuit with `skipped: completed_for_day`
- Otherwise resets counters + sets `cycle_date = todayUtc` on cycle start

At the registered schedule `*/20 11-23 * * *` there are 39 fire slots per UTC day. The 683-set catalogue completes in ~28 chunks (683 / 25 sets per chunk). The remaining 11 slots see `completed_for_day` and no-op. The invariant is **explicit and testable** via `SELECT cycle_date FROM pokemon_tcg_ingestion_cursor` rather than inferred from timestamps.

Operator-triggered bounded test runs can pass `?max_sets=N` to cap set processing (default = full `SET_BATCH=25`). Useful for verifying one chunk end-to-end without burning the full ~25 cr/chunk.

## 3. Corrected monthly cost projection (unchanged)

| Component | Monthly |
|---|---|
| MTG/YGO/OP/Lorcana baseline | ~18,000 cr |
| PP chunked daily scan | ~34,140 cr |
| PP discovery + health + FX + history sampler | ~2,100 cr |
| **Total** | **~54,240 / 150,000 (36%)** |

The 7% / 85% / 95% threshold alerts fire from `pp-tcg-ingest-health`; dedupe is per calendar month. Hard floor at 10,000 remaining credits pauses `pp-tcg-ingest-chunk` + `pp-tcg-history-sampler`.

## 4. Working USD/EUR preview

Deployed in this ticket:

- **`src/components/currency/CurrencySelector.tsx`** — client-side 2-button toggle, writes `pp_display_ccy` cookie (1-year), compact header styling. `previewOnly` prop renders a yellow "preview" badge for the admin surface.
- **Admin preview banner integration** — the full-template preview at `/admin/tcg-preview/[slug]/full` now shows the selector in its sticky banner. Clicking EUR writes the cookie and refreshes the page; the server reads the cookie and feeds `displayCcy='EUR'` + the latest FX table into `TcgGraphMarketPanel`.
- **TcgGraphMarketPanel converts side-by-side**: native price always shown first (`€2.54` for Cardmarket), converted amount below with `≈ $2.76` and a methodology note explaining the FX rate + `as_of` date. Native TCGplayer USD stays USD. Converted amounts carry an explicit note so they can never be confused with a native quote.
- **Zero TCGGraph calls on currency switch** — rate read from `pokemon_tcg_fx_rates`.
- **SEO-safe** — cookie layered on top of the same canonical URL. No `?ccy=EUR` variant. Server-side read means caching works per-user; the public card page template is unaffected because `providerMode` is only set in admin preview.

**Public-page activation is NOT in this ticket** — the selector exists only in the admin preview. Flipping it into the public shell is a 10-LOC follow-up once the licensing + rights decisions land.

## 5. Working promotional-set previews

9 of 12 proposals validated as real distinct TCG promo sets:

| TCG code | Name | Lang | Release | Members | State |
|---|---|---|---|---|---|
| svp | SV-P Promotional Cards | ja | 2024-10-18 | 323 | **approved** |
| mep | Mega Evolution Black Star Promos | en | 2025-09-26 | 78 | **approved** |
| sm11b | Dream League | ja | 2019-08-02 | 75 | **approved** |
| basep | Wizards Black Star Promos | en | 1999-07-01 | 60 | **approved** |
| np | Nintendo Black Star Promos | en | 2003-10-01 | 57 | **approved** |
| s8ap | Promo Card Pack 25th Anniversary | ja | 2021-10-22 | 20 | **approved** |
| g24137 | DP-P Promotional cards | ja | 2006-12-01 | 4 | **approved** |
| g24140 | ADV-P Promotional cards | ja | 2003-01-01 | 3 | **approved** |
| g24138 | PCG-P Promotional cards | ja | 2004-02-01 | 3 | **approved** |
| profp | Professor Program Promos | en | — | 5 | needs_more_data (no release date + low cards) |
| pwcp | Pikachu World Collection Promos | en | — | 3 | needs_more_data |
| lcc | League & Championship Cards | en | — | 2 | needs_more_data |

**0 duplicate memberships** across the proposals. Full report at `scripts/_pp-tcg-migrate-05/promo-validation.json`.

Burger King Promos (`bkp`) + Kids WB Promos (`kwbp`) did NOT make it to the proposals — they have only 1 verified PP mapping each, below the ≥2 threshold. Operator-approval surface is `pokemon_tcg_promo_set_proposals` where review_state can be flipped manually.

**No public URLs created** in this ticket. The admin surface shows the proposal counts + state. Public set pages behind `noindex` + sitemap entry decisions are the next phase.

## 6. Valid promo proposals + remaining unresolved

- **9 promo sets validated** as real, distinct TCG promos (above)
- **3 need more data** before approval (Professor Program, PWCP, LCC — no release date in TCGGraph set metadata)
- **~1,100 PP promo rows** stay in review (Topps / McDonald's / unmatched promo-adjacent rows that didn't verify-match to a specific TCG promo set)
- **0 Burger King / Kids WB** confusions — those sets had only 1 PP mapping each and were correctly excluded from proposals

## 7. Historical-data status + cost control

- **877 points on 28 cards** (from MIGRATE-02 manual pass)
- **New `/api/cron/pp-tcg-history-sampler`**: daily 05:00 UTC, picks up to 20 top-GSC cards without fresh history (defined as "no history point newer than 30 days"), hard-floor at 10,000 remaining credits
- **Dedupe verified**: the sampler query includes `WHERE cards without history point newer than CUTOFF`, so the SAME card is never re-fetched within the 30-day window
- **Zero visitor-triggered paid calls**: `getProviderSnapshot()` + `getProviderHistorySeries()` read only Supabase. No `/v1/prices/.../history` fetch anywhere in the public path.
- **Projection** (unchanged from MIGRATE-04): 60 cr/day × 30 = 1,800 cr/mo. Over 180 days reaches ~2,500 unique high-traffic cards; over 365 days ~5,000.
- **No full backfill performed.**

## 8. Actual price + image coverage

Unchanged from MIGRATE-02 reconciliation (overall denominator = 60,689 PP non-sealed cards):

| Cohort | Identity | Market safe | Graded safe | Image safe |
|---|---|---|---|---|
| Overall | 77.1% | 63.7% | 25.1% | 77.0% |
| EN | 83.4% | 71.9% | 37.7% | 83.4% |
| JA | 64.5% | 47.6% | 0.0% (provider has no JA graded) | 64.3% |
| Vintage | 97.2% | 66.7% | 31.5% | 97.2% |
| Promo | 25.4% | 16.7% | 10.4% | 25.4% |
| Variant | 76.5% | 59.1% | 0.0% (invariant) | 76.4% |
| Top-traffic | 73.4% | 54.3% | 34.1% | 73.4% |

The 25.1% overall graded coverage reflects: TCGGraph only publishes graded data for English cards + bulk_safe mappings qualify. Variants + Japanese correctly show 0% graded (invariant upheld).

## 9. Mapping approval readiness

**40 stratified approval samples inserted** into `pokemon_tcg_mapping_approval_samples` with `passed=null`:

| Cohort | Count |
|---|---|
| en-modern (Scarlet-Violet) | 10 |
| en-vintage (WOTC / Neo) | 6 |
| en-swsh | 6 |
| jp-modern (Japanese Scarlet-Violet) | 6 |
| top-traffic (GSC top-N) | 6 |
| promo-verified | 6 |

Operator workflow (full report at `scripts/_pp-tcg-migrate-05/approval-sample.md`):

1. Open `/admin/tcg-preview/{slug}/full` for each sample card (direct preview URLs listed in the report)
2. Verify TCG mapping matches physical card identity
3. Mark `passed=true` / `passed=false` + a reason
4. If sample pass-rate >95% → operator kicks off bulk-approve of the 23,474 bulk_safe candidates via the existing resumable batch

**Mapping approval is separate from public pricing activation.** Marking samples pass/fail does not switch any public read path.

## 10. Remaining licensing + cut-over blockers

Full list at `docs/pp-tcg-migrate-01/READINESS.md`. Updated status:

- 🔴 **Licensing**: `LICENSING_DRAFT.md` still unsent. Operator approval needed before sending.
- 🔴 **Image rights**: hotlink + commercial-display rights for `cards.tcggraph.io` NOT confirmed. `PP_USE_TCGGRAPH_IMAGES` stays off.
- 🔴 **Historical rights**: legal decision pending on legacy PriceCharting-derived series.
- 🟡 **Mapping approvals**: 40 stratified samples ready for operator review; bulk approve machinery ready to roll once sample pass-rate exceeds 95%.
- 🟡 **Promo set public URLs**: 9 approved proposals; URL/sitemap/indexing phase is a separate ticket post-approval.
- 🟡 **USD/EUR public selector**: live in admin preview; public header widget is a 5-LOC follow-up after approval.
- 🔴 **Legacy Python scraper decommission**: do NOT disable until 30+ days of stable TCGGraph public operation.

### Non-negotiable restrictions — all upheld
- No public card URL / canonical / sitemap / robots change
- No public TCGGraph flag flipped
- No scraper changes
- No new paid services
- No TCGGraph outreach sent
- All 46 hub tests + 49 PP-web tests pass
- Both apps' public card page builds unchanged

### Tests
- Hub: 46/46 vitest pass
- PP-web: 49/49 vitest pass
- Both typechecks clean
- Both builds green with all 5 crons + 3 preview routes compiled
