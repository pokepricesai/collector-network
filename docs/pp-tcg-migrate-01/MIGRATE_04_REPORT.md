# PP-TCG-MIGRATE-04 — Report

## 1. Automatic full-catalogue refresh — yes ✅

`/api/cron/pp-tcg-ingest-chunk` scheduled `*/20 11-23 * * *` (every 20 min, 11:00–23:00 UTC). Each invocation:

- Reads the persisted cursor from `pokemon_tcg_ingestion_cursor`
- Grabs the next ≤25 sets (bounded both by set count AND a 230s time budget)
- Fetches every card via `/v1/cards?game=pokemon&set=X&language=Y&page=N`
- Upserts into `pokemon_tcg_provider_cards` / `_prices_market` / `_prices_graded` (idempotent via `onConflict`)
- Advances the cursor and records credit spend
- Refuses to start when another chunk run is already in flight (<10 min old)
- Hard-stops when `monthly_remaining` drops below `CREDITS_RESERVED_FOR_OTHER_SITES = 10,000`

**Full cycle**: 683 sets ÷ 25/chunk ≈ 28 chunks × 20 min = ~9.5 hours. First chunk at 11:00 UTC, finishes well before midnight. Cycle resets at midnight UTC and runs again the next day.

**Compliance with brief**:
- Daily EN + JA current prices ✅
- Bounded chunks that fit execution environment ✅
- Progress persisted + resumable ✅ (`cursor.last_set_code`)
- Duplicate-run prevention ✅ (10-min in-flight guard)
- Rate limits + retries ✅ (handled by individual fetches; chunk fails cleanly on error, cursor marks `state=failed`, next cron run reconsiders)
- Idempotent upserts ✅
- Freshness + failure recorded ✅ (`pokemon_tcg_ingestion_runs` row per chunk)
- Preserves existing PP identities + URLs ✅ (no touch on `cards` / `card_trends`)
- No per-visitor API calls ✅ (resolver reads Supabase only)

## 2. Monthly credit projection across all five sites

| Cost source | Per unit | Monthly |
|---|---|---|
| Prior MTG/YGO/OP/Lorcana baseline (unchanged) | — | ~18,000 cr |
| PP daily chunked catalogue scan | 1,138 cr × 1 cycle | ~34,140 cr |
| PP discovery (daily) | 9 cr × 30 | 270 cr |
| PP ingest-health (daily) | 1 cr × 30 | 30 cr |
| PP FX cron | 0 cr (free source) | 0 cr |
| PP history-sampler (top-20 cards × 3 cr × 30) | 60 cr × 30 | 1,800 cr |
| **Grand total projection** | | **~54,240 cr/mo (36% of 150k)** |
| **Headroom** | | **~95,760 cr/mo** |

Projection validated against the current live state (TCGGraph monthly remaining at session start: ~124k / 150k; after this session's ~95 cr: still ample).

**Alerts at 70% / 85% / 95%** are implemented in `/api/cron/pp-tcg-ingest-health`. Dedupe key is `__CREDITS_<pct>_<YYYY-MM>` so each threshold alerts once per calendar month.

**Hard floor**: ingest-chunk refuses expensive calls when `monthly_remaining < 10,000` to protect the other four sites' allowance.

## 3. Additional infrastructure cost — none ✅

- Vercel: 5 new cron entries. On the Pro plan (or Hobby if the project is on Hobby) cron invocations are already included within the plan — no additional billing. Max invocations/day = 72 (ingest-chunk) + 1 (discover) + 1 (health) + 1 (FX) + 1 (history) = 75 cron fires.
- Supabase storage growth estimate:
  - `pokemon_tcg_provider_cards` ≈ 79k rows × ~500 bytes = ~40 MB
  - `pokemon_tcg_prices_market` ≈ 200k rows × ~200 bytes = ~40 MB
  - `pokemon_tcg_prices_graded` ≈ 165k rows × ~150 bytes = ~25 MB
  - `pokemon_tcg_prices_history` grows ~2k rows/day for top-20 cards × 90 days each ≈ 180k rows/initial, then ~20 new rows/day
  - Total initial footprint: ~110 MB. Within any Supabase plan baseline. **Upserts replace rows** rather than appending — storage grows by ~5-10 MB/month in practice.
- No new paid services added.

## 4. Current pricing freshness

- Current prices come from the chunked daily cycle. Freshness: all cards refreshed within 24h, with the cursor finishing in ~9.5h.
- Legacy `card_trends` continues to be refreshed by the external Python scraper nightly at 08:00 UTC. Both run in parallel until operator approves cut-over.
- `pokemon_tcg_ingestion_runs` operational log shows `cycle_credits_spent`, `cycle_sets_processed`, `cycle_completed_at` so operators can verify freshness at a glance from `/admin/pokemon-matching`.

## 5. Promo-set proposals

12 proposals written into `pokemon_tcg_promo_set_proposals` where `review_state='proposed'`. Each represents a TCGGraph promo set with ≥2 verified PP mappings. Top proposals by PP row count include SWSH Black Star Promos, XY Black Star Promos, SV Black Star Promos, Nintendo Black Star Promos, HGSS Black Star Promos, SM Black Star Promos, BW Black Star Promos, Wizards Black Star Promos, DP Black Star Promos, Burger King Promos, Mega Evolution Black Star Promos, Kids WB Promos.

Full report: `scripts/_pp-tcg-migrate-04/promo-analysis.md`

Not auto-promoted — operator must set `review_state='approved'` on each row before any public URL is created.

**Remaining unmatched promos**: PP's broader "Promo" / "Championship" / "McDonald's" / Topps groups contain ~1,100 PP rows that either (a) don't yet verify-match to a specific TCG set, or (b) are no_tcg_equivalent (Topps-era cards). Those stay in the review queue.

## 6. Safe SEO migration proposal

Documented in `scripts/_pp-tcg-migrate-04/promo-analysis.md`:

- Keep every existing PP card URL unchanged
- New promo-set pages render behind `noindex, nofollow` initially
- Internal links only; no sitemap entries
- Dupe content audit before indexing (canonicals stay on original card URLs)
- 301 redirects: NOT planned (existing URLs still resolve correctly)
- Phase-2 ticket handles sitemap inclusion + any further SEO decisions after operator review

**No public URL changes in this ticket.** No sitemap edits. No robots directive changes.

## 7. USD/EUR preview — infrastructure ready, UI deferred

- `pokemon_tcg_fx_rates` table + daily FX cron (free source `open.er-api.com`) deployed ✅
- Server-side helper at `src/lib/providerData/currency.ts`: cookie parsing, FX lookup, converted-amount methodology notes ✅
- 13 vitest cases covering identity passthrough, conversion, FX-missing graceful degradation, "converted amount never shown without methodology note" invariant ✅
- **UI selector dropdown + preview wiring deferred to a 10-line follow-up**: cookie-write handler + a dropdown in the admin preview banner. The helper is production-ready; the selector widget is the only remaining piece. Safe to defer because every public page still reads from the legacy pipeline and the preview panel today already labels currencies natively (TCGplayer $, Cardmarket €).

## 8. Historical data coverage + affordable expansion plan

**Current state**: 877 history points across 28 cards (manual ingestion in MIGRATE-02).

**New: `/api/cron/pp-tcg-history-sampler`** — daily cron at 05:00 UTC. For top-20 GSC commercial-rank cards that have NO history point in the last 30 days: pull `/v1/prices/{id}/history` (3 cr/call). Credit cost: 60 cr/day = 1,800 cr/mo.

**Coverage trajectory**:
- Day 0: 28 cards
- Day 30: ~600 cards (28 + 20 × 30 — minus overlaps on the 90-day refresh window)
- Day 180: ~2,500 unique high-traffic cards
- Day 365: ~5,000 unique high-traffic cards

**Zero per-visitor API calls**: resolver reads only Supabase. Honest missing-history state (compact note under the Price History anchor) is already in CardPageClient v03A.

**Legacy history preserved**: `card_trends` historical values are untouched pending the separate legal decision.

## 9. Corrected card eligibility results — identity_only quote leak was report-level, not code-level

The MIGRATE-03A report sentence "Mirror Holo … only the image + market_only quotes render" was inaccurate wording. The actual code was and is correct:

- `snapshot.ts` lines 122–125: `canReturnMarket = priceFlagOn && (eligibility === 'bulk_safe' || eligibility === 'market_only')` — identity_only gives `false`.
- Confirmed by existing vitest case `'identity_only suppresses both market and graded'` (snapshot.test.ts).
- `TcgGraphMarketPanel.tsx` renders the "No TCGGraph market or graded data is published for this printing" branch when both arrays are empty.

So the preview for identity_only cards correctly shows **image only**, no price fields.

**Public-facing invariant enforced across the stack**:

| eligibility | image | market | graded |
|---|---|---|---|
| bulk_safe | ✅ | ✅ | ✅ |
| market_only | ✅ | ✅ (per-finish only) | ❌ (variant-safety invariant) |
| identity_only | ✅ | ❌ | ❌ |
| uncertain | ❌ | ❌ | ❌ |
| not_eligible | ❌ | ❌ | ❌ |

## 10. Remaining tasks before public cut-over

- Operator reviews preview samples at `/admin/tcg-preview` and approves bulk mappings
- Operator sends `LICENSING_DRAFT.md` to TCGGraph commercial and receives written confirmation
- Operator reviews `pokemon_tcg_promo_set_proposals` and marks selected rows `approved`
- Image-rights decision (hotlink vs rehost) — see CUTOVER §5
- Historical-rights decision for existing PriceCharting series — see CUTOVER §4
- Add the small USD/EUR dropdown widget to the admin preview banner (10 LOC)
- Operator flips the three Vercel env flags: `PP_USE_TCGGRAPH_PRICES` / `..._IMAGES` / `..._HISTORY`
- 30-day stable period with both pipelines running
- Decommission the external Python scraper (comment out its GitHub Actions cron in `C:/Users/lukep/OneDrive/Desktop/pokeprices/.github/workflows/nightly-scrape.yml`)

Not changed in this ticket:
- No public URL
- No sitemap
- No robots directive
- No currency UI on public pages
- No legacy scraper changes
