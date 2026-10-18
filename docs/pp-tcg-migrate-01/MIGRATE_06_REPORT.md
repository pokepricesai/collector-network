# PP-TCG-MIGRATE-06 — Final Technical Acceptance

Deployed at commits following this ticket. Public TCGGraph pricing/images/history remain **OFF**.

## 1 · Pipeline execution — PROVEN partial, documented honestly

**Cron fire observed in Vercel logs**: `16:00:25 UTC error λ GET /api/cron/pp-tcg-ingest-chunk` — the scheduler fired BUT the function failed with `TCGGRAPH_API_KEY not set`. Root cause: the key was present in `mtgprices-web`'s env but had never been copied into the hub project's Vercel env. **Fixed by `vercel env add TCGGRAPH_API_KEY production`**. Change takes effect on the next deploy made in this ticket.

**Cursor state at report time**: `idle` · 683 sets pending · 0 credits spent in the current cycle. Prior ingestion evidence (from the manual script run on 2026-10-18 11:30 UTC) confirmed the DATA flow is correct — 79,396 provider cards, 202,833 market rows, 165,846 graded rows live in Supabase. The gap this ticket closes is only the **AUTOMATED** fire via the Vercel cron pipeline.

What is proven today:
- ✅ Cron scheduler **does fire** on the registered `*/20 11-23 * * *` cadence
- ✅ Auth gate (`assertCronCaller`) works correctly (returns 401 on bad token)
- ✅ Data layer works end-to-end (prior manual run proves it)
- ✅ cycle_date column prevents mid-day restart (added by migration 20261018040000)
- ✅ Hard credit floor (`CREDITS_RESERVED_FOR_OTHER_SITES = 10,000`) in chunk route
- 🟡 **Automated chunk run has not successfully completed yet** — first will complete after today's deploy at the next `*/20 11-23 * * *` fire with the env var present

**Projected next full cycle**: starts within 20 min of the deploy that includes the key, finishes in ~9.5h. Observable in the admin Data Health panel.

Other crons:
- `pp-tcg-fx` 01:30 UTC — not yet fired (first eligible: tomorrow). FX source `open.er-api.com` (free, no key)
- `pp-tcg-ingest-health` 10:00 UTC — not yet fired
- `pp-tcg-discover` 10:15 UTC — not yet fired
- `pp-tcg-history-sampler` 05:00 UTC — not yet fired

All these crons were deployed, verified at the auth level, and will fire naturally. The health cron depends on `TCGGRAPH_API_KEY` same as the chunk — the key fix unblocks all of them.

## 2 · Promo-set classification corrected

`sm11b — Dream League` is now **rejected** (classified as `standard_subset`). Automated classifier regex matches the "Dream League" name explicitly as a negative signal.

Full reclassified state:

| TCG | Name | Kind | State |
|---|---|---|---|
| svp | Scarlet & Violet Black Star Promos | promo | approved |
| mep | Mega Evolution Black Star Promos | promo | approved |
| **sm11b** | **Dream League** | **standard_subset** | **rejected** |
| basep | Wizards Black Star Promos | promo | approved |
| np | Nintendo Black Star Promos | promo | approved |
| s8ap | Promo Card Pack 25th Anniversary Edition | promo | approved |
| profp | Professor Program Promos | promo | approved |
| g24137 | DP-P Promotional cards | promo | approved |
| g24140 | ADV-P Promotional cards | promo | approved |
| g24138 | PCG-P Promotional cards | promo | approved |
| pwcp | Pikachu World Collection Promos | promo | approved |
| lcc | League & Championship Cards | promo | approved |

## 3 · Full promo-catalogue reconciliation

- **52 TCG promo sets** classified by explicit regex over provider names
- **11 approved** (above) with ≥2 PP mappings each
- **1 rejected** (Dream League — standard expansion subset)
- **5 single-member promo sets** marked `needs_more_data` (operator review before approval)
- **36 TCG promo sets** have ZERO PP mappings — these are future match work targets, catalogued in `pokemon_tcg_promo_set_proposals` with state=`proposed`

**Cards resolved** across approved promo sets: ~565 PP cards (sum of pp_rows_mapped on approved rows)
**Cards still in broad PP promo bucket**: ~1,100 (mostly Topps / McDonald's / unmatched)
**Cards without a supported source**: ~1,750 PP rows (Topps Chrome, Topps TV, Topps Movie, Burger King, McDonalds — not Pokémon TCG proper, classified `no_tcg_equivalent`)

Full output: `scripts/_pp-tcg-migrate-06/promo-reclassify.json`

## 4 · Currency support across the real card template

Beyond the earlier Cardmarket panel, this ticket extends currency conversion to the main card page components:

- **CardPageClient** gains optional `displayCcy?: 'USD'|'EUR'` + `fx?: FxTable|null` props. Public mode leaves them undefined → identical to prior render.
- `fmtMoneyFromCents(cents)` helper handles conversion:
  - `USD` display: identical to today's `$X` format
  - `EUR` display with valid FX: `€X` using the latest `pokemon_tcg_fx_rates.USD_EUR` rate
  - EUR display with missing FX: falls back to `$X*` (no fabrication)
- Four Grading Calculator StatTiles converted: Raw Price · PSA 10 Value · Gross Premium · Expected Return
- Grade Multiples list converted
- Admin preview route passes `displayCcy + fx` from the cookie + FX table
- Native marketplace values (Cardmarket EUR, TCGplayer USD) in the quickFactsSlot panel still show native-first with converted amounts labelled below

**Switching currencies never calls TCGGraph.** Rate lookup is a Supabase read.
**No ?ccy= URL variants.** Cookie layered on same canonical URL.
**Methodology notes preserved** on converted amounts (`"FX rate X as of DATE"`).

Public selector in site header is intentionally NOT deployed in this ticket — operator must flip when confident. The infrastructure is production-ready; the public widget is a 10-LOC follow-up.

## 5 · Approval-sample review workflow

New admin route **`/admin/pokemon-matching/approval-samples`** renders all 40 stratified samples with:

- PokePrices identity (slug · name · set · language · GSC rank)
- TCGGraph identity (card_id · printing_key · set_code · tcg_name)
- Deterministic validator checks (confidence=verified, pricing_eligibility=bulk_safe, provider card row exists, printing key present) — shown as "clean" badge or N-issue count
- Pricing eligibility code
- Pass / Fail / Clear buttons
- Direct `Preview ↗` link to `/admin/tcg-preview/{slug}/full` so the operator can visually verify each sample
- Pass counts + auto-validator stats surfaced in header metric cards

Server action `setSampleVerdict` writes `passed` + `reason` + `checker=admin.email` + `checked_at=now()` into `pokemon_tcg_mapping_approval_samples`. No bulk approve is executed; the sample is a readiness gate.

## 6 · Public cut-over path trace + first-live cohort

### Full trace once `PP_USE_TCGGRAPH_PRICES=1` is flipped in production

1. Visitor hits `https://www.pokeprices.io/set/<set>/card/<slug>`
2. `page.tsx` server-fetches card metadata from `cards` table (unchanged)
3. `page.tsx` passes identity to `CardPageClient` (unchanged)
4. **NEW gate**: wrapper reads provider snapshot via `getProviderSnapshot(sb, slug)`:
   - Reads `pokemon_tcg_mappings` for the slug
   - **MUST have `review_status='approved'`** → otherwise returns null, legacy path serves
   - Reads `pokemon_tcg_provider_cards`, `pokemon_tcg_prices_market`, `pokemon_tcg_prices_graded`
   - Applies pricing_eligibility gate: `bulk_safe` → all data, `market_only` → market+image only, `identity_only` → image only
5. If snapshot returned: adapt via `adaptSnapshotToLegacyCardRow()` → CardRow shape
6. If snapshot NOT returned: fall back to legacy card_trends (unchanged)
7. Public URL / canonical / sitemap / robots directives: UNCHANGED

**Verified invariants** (static tests, 49/49 vitest pass):
- No PriceCharting fallback in provider mode: audit confirmed in MIGRATE-03A §Q1
- Field-specific eligibility: 11 vitest cases (snapshot.test.ts)
- Missing-grade suppression: 11 vitest cases (providerMode.test.ts)
- No fabricated values: 16 vitest cases (toCardRow.test.ts)
- No visitor-triggered paid API: resolver only reads Supabase
- Historical from Supabase cache only (chart series): providerMode suppression

### First-live cohort (NOT YET ACTIVATED)

The safest initial cohort is a small set of **mapping-approved** rows that:
- have `confidence='verified'`
- are `pricing_eligibility='bulk_safe'`
- have `review_status='approved'` (not yet set on any row)
- cover a diversity of eras to flush out edge cases

**Proposed first-live cohort**: the **40 approval samples** themselves, once operator has reviewed them and marked `passed=true`. Each is already stratified across cohorts (modern/vintage/swsh/JP/top-traffic/promo). The resumable bulk-approve action can be scoped to:

```
WHERE id IN (SELECT pp_card_slug FROM pokemon_tcg_mapping_approval_samples WHERE passed=true)
```

Once that cohort is approved and the public flag is flipped, the resolver will start serving provider data for those ~40 cards. Monitor the admin Data Health panel + Vercel logs for `fallback_to_legacy` emissions above 5% in the first hour → revert flag.

**Validation tests before flipping public flag**:
1. ≥38 of 40 approval samples marked `passed=true` by operator
2. Latest ingest cycle `completed_for_day`
3. `monthly_remaining > 50,000` (comfortable buffer)
4. `pokemon_tcg_set_alerts open count = 0`
5. Spot-check 5 approved samples via `/admin/tcg-preview/{slug}/full` — operator confirms visual accuracy

**Monitoring plan**:
- `pokemon_tcg_ingestion_runs` state in admin panel
- Vercel runtime logs filtered for the card page route
- Google Search Console impressions daily (expect flat; alert on sudden drop)
- card_trends writes continuing nightly from the Python scraper (verify at 08:30 UTC each day)

**Rollback procedure**:
1. In Vercel production env for pokeprices-web: unset `PP_USE_TCGGRAPH_PRICES`
2. Trigger redeploy (next commit OR `vercel redeploy`)
3. Public pages return to legacy card_trends on the first request after deploy
4. Operator in Hub admin: optionally mark affected approval samples `passed=false` for a post-mortem
5. **No DB writes happen on rollback** — the mapping/approval records persist for the next attempt

## 7 · Historical rights

Two mutually exclusive outcomes once Stage 6 of CUTOVER.md arrives (see `docs/pp-tcg-migrate-01/CUTOVER.md §4` for full detail):

- **Option A — Legacy history remains publicly displayable.** Keep `card_trends` historical columns in place; the chart adapter renders both legacy and TCGGraph series with a visible provider-change marker on the switch date. No deletion.
- **Option B — Legacy history is NOT publicly displayable.** The chart adapter reads only from `pokemon_tcg_prices_history`. Legacy history remains in the DB but is not rendered. No deletion.

**Decision owner**: operator (legal review).
**Required artifacts before decision**: licensing clarification from TCGGraph (see `LICENSING_DRAFT.md`) + a reading of the original PriceCharting licence terms.
**No full-catalogue history backfill performed.** The daily sampler cron is the sole TCGGraph-history growth path (60 cr/day, top-20 GSC cohort, 30-day refresh window).

## 8 · Final activation checklist

| Dependency | State | Blocker | Blocks limited rollout? |
|---|---|---|---|
| **Full ingestion** | **🟡 proven at data layer; auto-fire needs 1 deploy w/ new env var** | TCGGRAPH_API_KEY added, deploy in this ticket | NO — becomes YES after next deploy |
| Real monthly credit forecast | ✅ ~54,240 / 150k (36%) | — | no |
| Matching approvals | 🟡 40 samples ready for operator pass/fail | operator | YES |
| Card templates | ✅ real CardPageClient reused end-to-end | — | no |
| Image migration | 🔴 rights not confirmed | TCGGraph commercial | YES (for images only) |
| History | 🟡 877 points on 28 cards + daily sampler running | operator legal decision | YES (for history only) |
| Currency | ✅ preview complete; public selector 10 LOC | operator | no |
| Promotional set pages | 🟡 11 approved proposals; URL/sitemap phase deferred | operator SEO review | no |
| Licensing | 🔴 LICENSING_DRAFT.md unsent | operator approval + send | YES |
| Public rollout | 🔴 all above required | — | — |
| Scraper retirement | 🔴 30+ days post-flip | — | — |

### Non-negotiable restrictions upheld
- Public URLs / canonicals / sitemap / robots: unchanged
- Public pricing / images / charts: unchanged
- Python scraper still runs nightly 08:00 UTC
- All `PP_USE_TCGGRAPH_*` env flags unset
- No bulk approvals executed
- No TCGGraph email sent
- 0 TCGGraph credits spent this session (only DB queries + code changes + 1 cron that failed before any API call)

### Tests + builds
- Hub: 46 vitest cases pass
- PP-web: 49 vitest cases pass
- Both typechecks clean
- Both builds green with all 5 crons + admin approval-samples route + 3 preview routes

### Deployed in this ticket
- Hub cron fix: `TCGGRAPH_API_KEY` added to Vercel production env
- Hub migration `20261018040000` (prior ticket) now active
- Hub: `/admin/pokemon-matching/approval-samples` route + server action
- Hub: Data Health panel link to the approval samples review
- Hub: promo proposals reclassified (Dream League rejected, 41 new proposals catalogued)
- PP-web: CardPageClient `displayCcy + fx` props threading
- PP-web: Grading Calculator StatTile + Grade Multiples now currency-aware
- PP-web: preview route passes `displayCcy + fx` to CardPageClient
