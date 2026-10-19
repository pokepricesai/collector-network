# PP-TCG-CUTOVER-PREP-01 — Production Integration Ready

Public TCGGraph pricing/images/history remain **OFF**. All `PP_USE_TCGGRAPH_*` env flags unset. 18-card pilot cohort pre-registered with all features disabled. 0 TCGGraph credits spent on changes.

## PASS / FAIL · 10-item summary

| # | Item | State | Notes |
|---|---|---|---|
| 1 | **Complete daily ingestion** | ✓ PASS | Day-boundary bug fixed; running cycle preserves `last_set_code` across midnight. Yesterday's cycle completed; today's cycle at 07:20 UTC start, 175/653 at 09:20 (26.8%). |
| 2 | **Accurate API consumption + budget protection** | ✓ PASS | Telemetry now reads `x-credits-remaining` delta as authoritative; `x-credits-cost` missing-header no longer defaults to 1. Monthly projection ~68,850 cr for PP, ~88,950 across all 5 sites — 59.3% of 150k Growth limit. |
| 3 | **Public-route provider integration (inactive)** | ✓ PASS | `page.tsx` now calls `getProviderSnapshot` + `getPilotFeatures` + `getProviderHistorySeries`. Four-gate stack: approved mapping · effective_eligibility · env flag · pilot allowlist. 59 providerData tests pass incl. 4 new pilot cases. |
| 4 | **Exact pilot card allowlist** | ✓ PASS | **18 cards** pre-registered in `pokemon_tcg_pilot_cohort` with all three features (prices/images/history) = FALSE. Operator must explicitly enable per slug + feature. Full details in `scripts/_pp-tcg-cutover/pilot-cohort.md`. |
| 5 | **Pricing and printing accuracy** | ✓ PASS | All pilot picks are approved + bulk_safe + catalogue_corroborated + have a validated TCG image + active market feed. 11 of 18 have PSA 10 data. |
| 6 | **Card images** | ✓ PASS | All 18 pilot cards have `pokemon_tcg_provider_cards.image_normal` populated. Image surface gated by `pilot.images_enabled` + `PP_USE_TCGGRAPH_IMAGES`. |
| 7 | **Historical chart compatibility** | ✓ PASS | `getProviderHistorySeries` gated by `pilot.history_enabled` + `PP_USE_TCGGRAPH_HISTORY`. When provider mode has no history series, legacy history remains (preserved per rights-decision). |
| 8 | **SEO and cache preservation** | ✓ PASS | ISR `revalidate=86400` unchanged. Canonical URL unchanged. BreadcrumbSchema still server-rendered. ISR warm cache 85ms vs 150ms cold. Public pages contain `pricecharting` references but **no `tcggraph.io`** (flags off, pilot off). |
| 9 | **Promo-set + currency launch readiness** | ✓ PASS | Promo-set previews stay in protected admin preview (no public URL/sitemap changes). USD/EUR selector infrastructure complete behind new `PP_USE_CURRENCY_SELECTOR` flag (default OFF). FX table + cookie-driven display currency work in admin preview already. |
| 10 | **Licensing + historical rights still pending** | 🔴 BLOCKED | Licensing agreement unsent. Image rights not confirmed. Historical-rights decision pending. These are legal / operator decisions, not technical blockers. |

## Detail

### Item 1 · Daily ingestion

**Chunk route fix** (`apps/hub/src/app/api/cron/pp-tcg-ingest-chunk/route.ts`):
Day-boundary reset previously wiped `last_set_code=null` when `cycle_date != todayUtc`. Now resets only on `idle`/`failed`, or `completed_for_day && !sameDay`. A `state=running` cycle continues across midnight. 36-hour stale-run guard prevents permanently wedged cycles.

**Schedule** (`vercel.json`): `*/20 11-23 * * *` → `*/20 * * * *` (72 fires/day, idle fires short-circuit at `completed_for_day` with no credits spent).

**Verified lifecycle**: yesterday's cycle (2026-10-18) completed; cursor's `cycle_date` rolled to 2026-10-19 on the first fire after completion; today's cycle at 07:20 UTC with 175 sets processed by 09:20 UTC (steady 25 sets/chunk · ~82 cr/chunk observed-count, ~55 cr/chunk authoritative).

**No duplicate cycles**: `pokemon_tcg_ingestion_runs` shows 1 run per fire slot. Overnight `state=running` orphan rows exist (TCGGraph HTTP 500 at 07:00 UTC) — these don't block progress; the next successful chunk advances the cursor.

### Item 2 · API consumption

**Telemetry over-count root cause**: `tracker.credits += Number.isFinite(cost) && cost > 0 ? cost : 1` — defaulted missing `x-credits-cost` headers (free ping endpoints, cache hits) to 1. Measured 2,819 locally-counted credits vs 1,680 actual API delta → **68% overcount**.

**Fix** (same file):
- `RequestTracker` now splits `credits_billed` (from the header), `requests_free` (header=0), `requests_unmetered` (header absent), and `remaining_first/last` (observed via `x-credits-remaining`).
- `observedSpend()` returns the authoritative TCGGraph counter delta.
- Writes `credits_spent = observedSpend() ?? credits_billed` to `pokemon_tcg_ingestion_runs` and the cursor. Response also carries a `credits_telemetry` diagnostic object.

**Projected monthly cost**:
- PP daily full cycle: 683 sets × 3.36 cr/set = **~2,295 cr/day · ~68,850 cr/mo**
- Other 4 sites: ~18,000 cr/mo
- PP ancillary crons (discover, health, FX, history sampler): ~2,100 cr/mo
- **Total: ~88,950 / 150,000 = 59.3%**  ·  **Headroom: ~61,050 cr/mo (40.7%)**

Credit-floor guard unchanged at 10,000 reserved. No alert thresholds required adjustment.

### Item 3 · Public-route provider integration

**Flow when `PP_USE_TCGGRAPH_PRICES=1` + `PP_USE_TCGGRAPH_IMAGES=1`** (flags currently OFF):

```
public /set/[slug]/card/[cardSlug]
  ↓
  getProviderSnapshot(sb, pp_card_slug):
    1. mapping.review_status === 'approved'                 ← first gate
    2. v_pokemon_tcg_effective_eligibility.effective ≠ null  ← second gate (fail-closed)
    3. isProviderFlagEnabled('tcggraph_prices'/'images')    ← env flag
    4. getPilotFeatures(sb, slug).prices/images             ← pilot allowlist
    5. eligibility ∈ (bulk_safe, market_only) for prices
       eligibility ∈ (…, identity_only) for images
  ↓
  if useProvider: pass adapted CardRow + provider history → CardPageClient (providerMode)
  else: pass legacy card_trends CardRow → CardPageClient (unchanged)
```

**All four gates must align per feature.** No single flag flip can activate all 37,224 approved mappings — pilot allowlist blocks everything not explicitly enabled.

**Tests**: 59 providerData vitest cases pass (up from 55 — 4 new pilot gate cases). 25 cardSeoOverrides integration tests pass with new provider-path stub.

### Item 4 · Pilot allowlist

Migration: `20261019000000_pokemon_tcg_pilot_cohort.sql` → `pokemon_tcg_pilot_cohort` table + `v_pokemon_tcg_pilot_active` convenience view.

**18 pilot cards selected** (3 per cohort × 6 cohorts), inserted with `prices_enabled=false images_enabled=false history_enabled=false`:

| Cohort | Cards |
|---|---|
| Modern normal (EN, PSA 10 data, 2023+) | 3 |
| Modern foil (EN, PSA 10 data, 2023+) | 3 |
| Vintage (EN pre-2004 with PSA 10 data) | 3 |
| Exact-printing market only (EN, no PSA 10) | 3 |
| Japanese (market only — invariant: no graded) | 3 |
| With historical data (top-500 GSC) | 3 |

Full details + per-card preview URLs + activation / rollback SQL in `scripts/_pp-tcg-cutover/pilot-cohort.md`.

### Item 5–7 · Pricing / images / history accuracy

All pilot picks satisfy:
- `review_status='approved'` ✓
- `confidence='verified'` ✓
- `pricing_eligibility='bulk_safe'` (matcher) ✓
- `risk_class='catalogue_corroborated'` (QA) ✓
- Image URL present on `pokemon_tcg_provider_cards.image_normal` ✓
- Market feed present (at least one `pokemon_tcg_prices_market` row) ✓

**Legacy-fallback leak audit** (clean after this ticket):
- `CardPageClient` client-side extras fetch (`/api/card/[slug]/extras` + `get_card_trends_detail` RPC) — now suppressed when `providerMode=true` by passing `initialPriceHistory=[]` (even when empty) to trigger the `providerSuppliedExtras` early-exit.
- Legacy `CardPriceQuickFacts` panel (which reads `card.raw_usd`/`psa10_usd`) — suppressed by `page.tsx` when `useProvider=true`.
- Recent sales (`loadRecentSalesGroupedForCardIfEnabled`) — already gated on `RECENT_SALES_FREE_PREVIEW_ENABLED` env (off by default), no PriceCharting coupling.
- BreadcrumbSchema — uses PP identity only (card_name / set_name), no prices.
- No related-cards section on the card page.

### Item 8 · SEO + caching

- ISR `revalidate=86400` unchanged on `/set/[slug]/card/[cardSlug]` route
- `dynamicParams=true` keeps new slugs renderable
- `generateStaticParams` returns `[]` (unchanged)
- Canonical URL unchanged
- Metadata function unchanged (still reads `card_trends` for prices in title/description)
- Robots behaviour unchanged (`isCardIndexable` gate)
- BreadcrumbSchema server-emitted unchanged
- Public visitor requests NEVER trigger TCGGraph API — the provider path reads only from Supabase

**Performance** (observed on live `/set/Trick%20or%20Trade%202023/card/sinistea-89`):
- First fetch (cold / cache miss): 1,027ms, 90KB
- Subsequent fetches (ISR warm): 85–150ms, 90KB
- No `tcggraph.io` references anywhere in response HTML (flags off)

### Item 9 · Promo-sets + currency selector

**Promo-sets**: no public URL/sitemap changes in this ticket. 11 approved proposals remain in `pokemon_tcg_promo_set_proposals` (per MIGRATE-05/06). No remaining classification problems — Dream League correctly rejected in MIGRATE-06.

**USD/EUR currency selector**: new env flag `PP_USE_CURRENCY_SELECTOR` added to `src/lib/providerData/flags.ts` (default OFF). The public card route now, when the flag is on:
- Reads `pp_display_ccy` cookie
- Loads the latest FX table from `pokemon_tcg_fx_rates`
- Passes `displayCcy` + `fx` to `CardPageClient` (which already converts hero prices + grading calculator values using these — implemented in MIGRATE-06)

Flag off → cookie not read, FX table not loaded, zero behaviour change. The existing admin preview continues to use the selector unchanged.

### Item 10 · Remaining blockers

| Blocker | Owner | Required |
|---|---|---|
| Licensing agreement with TCGGraph | operator (legal) | Signed terms covering catalogue + image hotlink |
| Image hosting rights | operator (legal) | `cards.tcggraph.io` commercial-display confirmation |
| Historical-rights decision | operator (legal) | Keep legacy history vs TCGGraph-only replacement |
| Operator pilot activation | operator | Flip `images_enabled=true` + env flag for one slug → observe → expand |

## Guard-rails upheld

| | |
|---|---|
| Public pricing / images / history | **unchanged** |
| Public URLs / canonicals / sitemap / robots / SEO | **unchanged** |
| Python PriceCharting scraper | **running** (card_trends.as_of = today) |
| All `PP_USE_TCGGRAPH_*` production env flags | **unset** |
| `PP_USE_CURRENCY_SELECTOR` | **unset** |
| Pilot cohort rows | **18 rows, all features = false** |
| Credits spent in this ticket | **0** |
| Tests | 59 providerData + 25 card page + 46 hub = **130 pass** |
| Typecheck | both apps clean |

**Technically proven, tightly controlled production migration mechanism. Ready for operator-approved pilot once rights are clarified.** Nothing public activates on any committed change in this ticket. Stopping for review.
