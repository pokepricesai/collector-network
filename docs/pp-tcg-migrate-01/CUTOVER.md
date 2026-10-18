# PP-TCG-MIGRATE-01 — Cut-over + Rollback Playbook

**Status at commit time:** Full infrastructure built + ingested. **No public switch.** PriceCharting pipeline still runs.
**Audience:** operator (Luke).

---

## 0. The six distinct states a card goes through

Separate concepts — approving an identity does NOT activate pricing.

| State | Table / column | Trigger |
|---|---|---|
| 1 — Identity matched | `pokemon_tcg_mappings.tcg_card_id IS NOT NULL` | Matcher v2 (automated) |
| 2 — Match approved | `pokemon_tcg_mappings.review_status = 'approved'` | Operator Bulk Approve or per-card review |
| 3 — Provider price ingested | row exists in `pokemon_tcg_prices_market` / `pokemon_tcg_prices_graded` for the mapping's `(tcg_card_id, tcg_printing_key)` | `scripts/pp-tcg-migrate-01-ingest.mjs` (manual today; cron tomorrow) |
| 4 — Field-level eligibility validated | `pokemon_tcg_mappings.pricing_eligibility ∈ {bulk_safe, market_only}` AND a per-field spot-check passes | Operator sign-off panel in admin (to be added) |
| 5 — Public activation authorised | Env flag `PP_USE_TCGGRAPH_PRICES=1` set in Vercel production (and/or the equivalent for images / history) | Operator in Vercel UI |
| 6 — Public activation completed | pokeprices.io renders provider snapshot via `getProviderSnapshot()` | Automatic once state 5 is set |

**Flipping a flag flips reads only.** No writes happen on cut-over. The reverse flip restores legacy reads instantly.

---

## 1. What's currently running (as of 2026-10-18)

| Pipeline | Where it runs | Writes to | Scraper schedule |
|---|---|---|---|
| **Legacy** (PriceCharting-derived) | `C:/Users/lukep/OneDrive/Desktop/pokeprices/` Python repo + GitHub Actions | `daily_prices` → rebuilds `card_trends` every night | `0 8 * * *` (08:00 UTC) in `.github/workflows/nightly-scrape.yml` |
| **New** (TCGGraph) | Manual node scripts for now | `pokemon_tcg_provider_cards`, `pokemon_tcg_prices_market`, `pokemon_tcg_prices_graded`, `pokemon_tcg_set_alerts`, `pokemon_tcg_ingestion_runs` | Not scheduled — operator runs on demand |

**Both pipelines coexist safely.** The TCGGraph pipeline writes to different tables, so there is zero collision. The public website still reads from the legacy `card_trends`.

---

## 2. Pre-cut-over readiness checklist

Before flipping ANY public flag:

- [ ] Operator reviews a non-trivial sample of `bulk_safe` approved mappings via `/admin/pokemon-matching/{slug}` and confirms the TCGGraph suggestion matches the correct physical card
- [ ] Operator confirms the full catalogue ingestion run completed cleanly (admin "Data health" panel shows a `completed` run with ≥ 70k provider cards)
- [ ] Operator confirms open `pokemon_tcg_set_alerts` are acknowledged or triaged (none urgent)
- [ ] Licensing clarification from TCGGraph received (see `LICENSING_DRAFT.md`)
- [ ] Historical-data display rights decided (see §4 below)
- [ ] Image rights decided (see §5 below)

Do NOT skip the licensing step. The ingestion itself is permitted under our subscription (we're reading, not publishing); the public display is the step that needs confirmed rights.

---

## 3. Staged activation sequence

Each flag is a Vercel env variable on the pokeprices-web Vercel project. Default (unset or `0`) is OFF. The flag only takes effect after the next deployment.

### Stage 1 — Internal preview (no public impact)

Add env flags to a **preview deployment** only, not production:

```
PP_USE_TCGGRAPH_PRICES=1   # preview env
PP_USE_TCGGRAPH_IMAGES=0
PP_USE_TCGGRAPH_HISTORY=0
```

Operator reviews ~20 sample card pages on the preview URL. Confirms:
- Prices look reasonable
- No empty / zero displays
- Pricing eligibility gate works (variants show per-finish market only; graded is suppressed)

### Stage 2 — Small live test cohort

For a controlled rollout to live, the preferred mechanism is a **row-level flag** rather than an env flag. Add a `tcg_price_live` boolean to `pokemon_tcg_mappings` (nullable, default false), set it `true` for ~50 specific slugs the operator picks, and gate the public render on `(flag_env OR row_flag)`. This is NOT built yet — flag `TODO-stage-2`.

For stage 2, the simplest implementation is: enable `PP_USE_TCGGRAPH_PRICES=1` only in a specific **preview branch** that uses a URL like `pokeprices-pretcg-canary.vercel.app`. Operator shares that URL with a trusted tester. No change to the production domain.

### Stage 3 — Normal-card cohort (production, prices only)

In Vercel production env for pokeprices-web:
```
PP_USE_TCGGRAPH_PRICES=1
PP_USE_TCGGRAPH_IMAGES=0
PP_USE_TCGGRAPH_HISTORY=0
```

The resolver at `pokeprices-web/src/lib/providerData/snapshot.ts` only returns prices for mappings with `review_status='approved'` AND `pricing_eligibility='bulk_safe'`. Everything else keeps reading legacy `card_trends`.

### Stage 4 — Variant printings (market quotes only)

```
PP_USE_TCGGRAPH_PRICES=1   # bulk_safe + market_only prices
```

Variants (`market_only`) now get per-finish market quotes from TCGGraph. Graded prices for variants remain suppressed (TCGGraph aggregates graded across printings).

### Stage 5 — Images

```
PP_USE_TCGGRAPH_IMAGES=1
```

The image resolver swaps PP card images for `cards.tcggraph.io/...` URLs where a provider card record has an `image_normal`. Only after image rights are confirmed from TCGGraph (see §5).

### Stage 6 — Historical charts

```
PP_USE_TCGGRAPH_HISTORY=1
```

The chart adapter switches to series from `pokemon_tcg_prices_history`. See §4 — this is only safe once the historical-rights question is resolved.

### Stage 7 — Decommission the legacy scraper

**Only once Stage 6 is live and stable:**

1. In `C:/Users/lukep/OneDrive/Desktop/pokeprices/.github/workflows/nightly-scrape.yml`, comment out the `cron:` trigger (keep `workflow_dispatch` so you can still run manually if needed).
2. Keep the Python repo + GitHub secrets intact for 30 days in case of rollback.
3. After 30 days of successful TCGGraph-only operation, archive the Python repo and revoke its Supabase service-role credentials.

---

## 4. Historical data — rights-sensitive

Three mutually exclusive outcomes once Stage 6 arrives:

**(a) Old PriceCharting-derived history is legally shareable.** Keep it in `card_trends` + related tables. The chart adapter renders both series with a visible provider-change marker on the switch date. No chart data is deleted.

**(b) Old history is NOT legally shareable, but the pure TCGGraph history is deep enough.** The chart adapter reads only from `pokemon_tcg_prices_history`. Legacy history remains in the DB but is not rendered. No deletion.

**(c) Old history is NOT legally shareable AND TCGGraph history is thin.** The chart renders a short truncated series with a note explaining that longer history is unavailable under current licensing. Honest, not fabricated.

Do not delete `card_trends` historical columns until a legal review decides which outcome applies.

---

## 5. Image migration — rights-sensitive

Legacy `cards.image_url` points to a mix of sources. The migration plan is:

1. Audit current `cards.image_url` for domain distribution — list all unique hosts.
2. Any images sourced from PriceCharting lose display rights at Stage 7 regardless of what else happens.
3. For `cards.tcggraph.io` images, require written confirmation of commercial display + hotlink rights per `LICENSING_DRAFT.md` §6.
4. If TCGGraph grants hotlink + commercial display rights, flip `PP_USE_TCGGRAPH_IMAGES=1`.
5. If TCGGraph grants display but NOT hotlink, operator proxies images via Cloudinary / Vercel image optimisation.
6. If neither right is granted, retain a neutral placeholder on cards whose image rights are unresolved.

---

## 6. Rollback

Each stage is reversed by unsetting its env flag and redeploying. The resolver returns to legacy behaviour on the first request after the deploy — **no DB write happens**.

**Rollback must NOT silently reintroduce unlicensed PriceCharting data once:**
- Its scraper has been decommissioned (post-Stage 7), OR
- A legal opinion has stated the old data is not shareable (per §4-b or §4-c).

For either of those cases, the correct rollback is to a **neutral error state** ("Price data temporarily unavailable") rather than re-serving legacy prices. The resolver should be updated to enforce this at Stage 7.

Record every flag flip in a changelog file (`docs/pp-tcg-migrate-01/CHANGELOG.md`) with timestamp and operator.

---

## 7. Observability during cut-over

The admin page at `/admin/pokemon-matching` shows:
- Last ingestion run (state, credits, row counts)
- Last discovery run
- Open set alerts
- Approved vs bulk_safe counts

Add to Vercel log drains or Datadog:
- `[provider] fallback_to_legacy` log line emitted whenever `getProviderSnapshot()` returns null for an approved mapping (indicates a provider gap)
- `[provider] fatal` for any Supabase error in the resolver

If `fallback_to_legacy` rate exceeds 5% in the first hour post-flip, revert the flag.

---

## 8. Scripts cheat sheet

```bash
# Full catalogue ingestion (EN + JA, 1,138 credits)
node scripts/pp-tcg-migrate-01-ingest.mjs

# English only
node scripts/pp-tcg-migrate-01-ingest.mjs --en-only

# Daily set-discovery (~8 credits)
node scripts/pp-tcg-migrate-01-discover.mjs

# Coverage report (no credits)
node scripts/pp-tcg-migrate-01-coverage.mjs

# Rematch (uses saved local catalogues, no credits)
node scripts/pp-tcg-match-02-rematch.mjs
```

---

## 9. Decision log

Record every flag flip + staged-rollout decision here with date, operator, outcome. First row entered on cut-over day.
