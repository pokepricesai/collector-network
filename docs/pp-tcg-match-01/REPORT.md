# PP-TCG-MATCH-01 — Implementation Report

**Date:** 2026-10-18
**Scope:** Pokémon only. Admin-only build. No live pricing changed.
**Admin URL:** `/admin/pokemon-matching` on the hub.

---

## 1. What shipped

### Database (migration `20261018000000_pokemon_tcg_mappings.sql`, applied to live Supabase)

- `pokemon_tcg_set_aliases` — operator-maintained PP set → TCGGraph set-code map (pre-seeded with WOTC + Neo + E-series)
- `pokemon_tcg_mapping_candidates` — matcher-generated per-PP-card candidates (regenerable)
- `pokemon_tcg_mappings` — one approved/pending row per PP card, per provider
- `pokemon_tcg_mapping_audit` — append-only history of status changes
- `pokemon_tcg_price_snapshots` — Phase-8 placeholder for provider price staging (empty; disabled)
- `pokemon_tcg_mapping_status_v` — admin dashboard aggregation view

All tables RLS-protected via `public.network_is_admin()`. Not readable by anonymous users; not readable by regular signed-in site users. Zero touch on `cards` / `card_trends` / any public pricing surface. Future providers (JustTCG) plug in via the `provider` column without a schema change.

### Admin workbench

- `/admin/pokemon-matching` — list view with status/confidence/language filters, search, pagination.
- `/admin/pokemon-matching/{pp_card_slug}` — per-card review (side-by-side PP + TCGGraph).
- Server actions: `approveCurrentMapping`, `reassignToCandidate`, `rejectMapping`, `undoMapping`, `bulkApproveVerified`, `addSetAlias`.
- Bulk-approve: one click approves the 43,766 verified pending mappings (with dry-run preview + language filter).
- Each action writes to `pokemon_tcg_mapping_audit` through the admin's session Supabase client — no privileged bypass.
- No action modifies `cards` or `card_trends`.

### Improved matcher (saved to `scripts/pp-tcg-match-01-seed.mjs`)

Uses the full 56,808-record TCGGraph catalogue local export. For each of 60,689 PP non-sealed cards, generates up to 5 candidates by:

1. **Set alias**: operator-approved PP-set → TCG-set-code map (consulted first).
2. **Exact set + collector# + name + variant-printing-key** match (highest confidence).
3. **Name + collector# + language** without set resolution (medium confidence).
4. **`baseCardId` reprint chain**: for cards whose primary match has promo reprints (store exclusives, World Championship decks, Prize Pack), surface those reprints as additional candidates so the operator can pick the specific physical product.

Candidate storage keeps the primary match AND alternates so the admin UI shows the full picture.

PP `[Variant]` tag → TCGGraph `printings[].key` mapping (not a schema, a dict in the matcher) handles 19,626 of 25,727 variant rows (76.3%). 6,101 PP variants cannot be mapped (Mirror Holo, Jumbo, Prize Pack, Rainbow Foil, Stamped, Prism, Gold Star) — TCGGraph does not expose those as discrete printing keys.

---

## 2. Current matching state after seed

| Status | Confidence | Count |
|---|---|---|
| pending_review | **verified** | **43,766** |
| pending_review | medium | 8,341 |
| pending_review | low | 4,316 |
| unmatched | — | 4,266 |

**43,766 cards (72.1%) are ready for one-click bulk approval.** They have exactly one high-confidence TCGGraph candidate at set + collector# + name match. Confirming "verified" meaning: a single candidate exists for the primary printing-key, no competing TCG card at the same set+number position.

Breakdown by language:
- EN verified bulk-approvable: 32,206
- JP verified bulk-approvable: 11,560

The medium/low pending require manual review (see Phase 1 crosswalk notes below).

---

## 3. Phase 1 — Promo-set audit (summary; full detail in `/scripts/_pp-data-test-02/outputs/`)

TCGGraph represents promos in dedicated small sets (`xyp` XY Black Star Promos, `wcd2015` World Championship Decks, etc.) and backlinks reprints via `baseCardId`. The improved matcher now:

- Consults set aliases first — many PP WOTC "Base Set" rows mapped to the correct TCG set-code (`base1`).
- Falls through name+number if alias not found.
- Surfaces `baseCardId` reprints as alternate candidates so operators can decide between the base card and promo reprints.

Remaining structural gaps (PokePrices has records TCGGraph does not):

- 1999 Topps Movie, Topps TV, Topps Chrome (~900 rows) — Topps-produced trading cards, not Pokémon TCG proper. **No equivalent in TCGGraph.** Expected `no_tcg_equivalent` status.
- McDonalds 2016–2024 (~175 rows). Some match via `baseCardId`; most have no equivalent.
- Burger King, Fire Red & Leaf Green merchandise, Pikachu Libre & Suicune. Case-by-case.

The admin workbench's "Mark as no equivalent" action persists this decision so the matcher doesn't re-propose candidates on re-run.

---

## 4. Phase 5 — Pricing & grading field findings (10-card probe, 10 credits spent)

### Graded dimensions actually exposed by TCGGraph

- **Graders**: `raw`, `any`, `psa`, `bgs`, `cgc`, `sgc` (6 total)
- **Grades**: `ungraded`, `7`, `8`, `9`, `9.5`, `10`
- **Grader × grade pairing**:
  - `raw` only pairs with `ungraded`
  - `any` pairs with 7 / 8 / 9 / 9.5 (pooled across all graders at these grades)
  - `psa`, `bgs`, `cgc`, `sgc` each only pair with `10`

**Hard rule confirmed by schema and live data: grade 7, 8, 9, 9.5 are pooled across all graders. Never relabel as "PSA 9".**

### Market dimensions

- **Sources**: `cardmarket`, `tcgplayer` (verified on all 10 probes). `cardkingdom`, `manapool` are MTG-only.
- **List types**: `retail` only on Pokémon. (`buylist` exists on CardKingdom MTG.)
- **Finish**: discrete printing variant (normal, foil, 1st-edition, shadowless, cosmos-holo, pokeball, etc.) — 22 total keys in Pokémon catalogue.
- **Currency**: USD for TCGplayer, EUR for Cardmarket.

### Condition exposure

- **TCGplayer rows have NO condition field.** The 10/10 probes returned zero condition breakouts. TCGplayer market prices are per-finish, not per-condition.
- **Cardmarket `languagePrices[]` DOES expose condition** — per-language-per-condition rows with `condition` in `{mt, nm, ex, gd, lp, pl, po}` and `low` / `offers` fields.
- There is no realised-sales condition split; only asking-price condition split via Cardmarket.

### Design implications for future display schema

| UI field | Should store | Why |
|---|---|---|
| grader | enum('raw','any','psa','bgs','cgc','sgc') | distinguishes pooled vs per-grader |
| grade | enum('ungraded','7','8','9','9.5','10') | |
| finish | the TCG printing key | distinguishes variants |
| source | enum('tcgplayer','cardmarket','cardkingdom','manapool') | |
| list_type | enum('retail','buylist') | buylist only on cardkingdom |
| currency | enum('USD','EUR') | per-source |
| condition | enum('mt','nm','ex','gd','lp','pl','po') OR 'any' | only cardmarket exposes this |
| valuation_methodology | enum('realised_avg','market_quote','low_asking') | realised = graded prices, market = tcgplayer market, low = cardmarket low |

The Phase-8 `pokemon_tcg_price_snapshots` table is a start, not the final shape. It stores the top-level values; a future provider-side ingestion will need per-finish and per-condition rows.

---

## 5. Phase 6 — Divergence math reconciled (file: `/scripts/_pp-tcg-match-01/divergence-math.json`)

CN-DATA-TEST-01 reported "~58% median raw divergence, ~55% median PSA10 divergence." Reproduced with full evidence on the 125/114 original pairs.

### Classification of each pair after re-reconciliation

| Class | Raw pairs | % | Median abs diff |
|---|---|---|---|
| `identical` (same card, no variant, <2% diff) | 21 | 16.8% | **0.0%** |
| `legitimate_diff` (same card, no variant, >2% diff) | 6 | 4.8% | 22.5% |
| **`wrong_printing` (same card id, PP has [Variant], TCG raw is aggregated)** | **85** | **68.0%** | **70.4%** |
| `wrong_card` (matched to a different TCG card entirely) | 13 | 10.4% | 54.8% |
| **Overall median (unchanged from CN-01)** | 125 | | **58.2%** |

Same pattern for PSA10 (79/114 wrong_printing, 23 identical, 9 wrong_card).

### Mathematical explanation

The 58.2% was dominated by two systematic errors:

1. **~10% wrong card** — CN-DATA-TEST-01's matcher used `?name=X&collectorNumber=N` without set-code constraint. A card like "Charizard #4" exists in Base Set, Base Set 2, World Championships 2015, Celebrations, etc. The API returned a plausible match, often the wrong one.

2. **~68% wrong printing** — PP stores one row per variant: `Charizard [1st Edition]`, `Charizard [Shadowless]`, `Charizard [Reverse Holo]`, `Pikachu [Sparkle]`. CN-01 matched by stripped name → correct TCG card id, but then compared PP's variant-specific realised-sales value (e.g. "Sparkle Pikachu $1,312.75") to TCGGraph's `gradedPrices[grader=raw, grade=ungraded]` which is **aggregated across all printings for that card id**. For Sparkle variants worth 100× their base-printing counterpart, the comparison produces −99%+ divergence. See top-10 outliers in the JSON — all Sparkle/Tekno/Reverse Holo PP rows with TCG aggregates diluted by thousands of non-variant sales.

### After correction

**Restricted to same-card, no-variant pairs: 27 raw pairs, median diff 0.0%; 26 PSA10 pairs, median diff 0.0%.**

### Identical-source hypothesis — evidence only

The 0.0% diff on 27 raw pairs and 26 PSA10 pairs is **extremely strong** evidence of a shared upstream dataset. Both PriceCharting (PokePrices' historical pipeline) and TCGGraph aggregate from eBay realised sales. For a 27-pair sample to coincidentally produce zero divergence across both raw and PSA10 is implausible under independent methodologies — the probability under truly independent averaging methodologies would be near zero.

**However** this is still inference from identical values, not a confirmed data-licensing relationship. The licensing-review checklist (§8 below) includes an explicit question for TCGGraph: *"What is the ultimate source of your Pokémon raw ungraded and PSA 10 valuations? Is it eBay realised-sales derived? Do you license from a third-party index (e.g. PriceCharting)?"*

Do not assert shared sourcing in public communication until TCGGraph confirms.

---

## 6. Phase 7 — Current `card_trends` writer lineage

Audit confirmed by code grep across `pokeprices-web`, `supabase/functions/*`, `supabase/migrations/*`, GitHub workflows, Vercel config:

- **No code in `pokeprices-web` writes to `card_trends`.** All in-repo references are read-only (edge functions `smart-endpoint`, `content-studio-generate`, `evaluate-alerts`; app pages; alerts digest).
- Commit `c10e07f` (PP-URGENT-01, Oct 2026) explicitly removed PriceCharting attribution/text but noted: *"The nightly `raw_usd / psa9_usd / psa10_usd` figures are aggregated guide values derived from recent sold-sales data."* "Nightly" implies a scheduled external job.
- Migration note in `2026-06-17-recent-sales-stage-1.sql`: references a *"sister scraper repository"* writing to the shared Supabase.
- No Supabase pg_cron registered.
- No Vercel cron on the pokeprices-web project writes `card_trends`.

**Conclusion:** `current_raw` / `current_psa10` / `current_psa9` are populated by an **external scraper repository** that writes directly to the shared Supabase using service-role credentials. The scraper is outside this monorepo.

**For a safe future cut-over:** we need operator to confirm which repo/service runs the scraper. Options:
- If the operator still has access and it's a well-isolated project, pause the external scraper after Phase 8 goes live.
- If the scraper is unknown or abandoned, the current values will go stale — the Phase 8 activation gate must handle "last-known value with timestamp" gracefully.

Design doc Phase-8 §Activation (below) covers this.

---

## 7. Phase 8 — Controlled price activation (DESIGN; NOT ENABLED)

### Future activation flow

```
┌─────────────────┐    ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────────────────┐
│  Mapping is     │ →  │  Provider price  │ →  │  Validation      │ →  │  Operator flips flag;        │
│  approved       │    │  ingested into   │    │  gate            │    │  public pages read provider  │
│  (status=       │    │  pokemon_tcg_    │    │  (raw/PSA10/raw) │    │  prices for this one card    │
│  approved)      │    │  price_snapshots │    │  freshness OK    │    │                              │
└─────────────────┘    └──────────────────┘    └──────────────────┘    └──────────────────────────────┘
```

### Not implemented in this ticket

1. **Scheduled TCGGraph ingestion** → `pokemon_tcg_price_snapshots`. Target cadence per PP-DATA-TEST-02: daily EN catalogue scan (530 cr/day = 15,900 cr/mo = 11% of allowance) + daily JP (608 cr/day = 18,240/mo = 12%). Combined with the current 18,453/mo baseline ≈ 35% of allowance. Fits.

2. **Public read-path switch**. Would need a feature flag per `pokemon_tcg_mappings.activation_eligible` + a renderer that chooses provider snapshot vs legacy card_trends for a given card.

3. **Fallback behaviour** — if provider feed fails, the published page shows "Last known licensed value: $X (as of Y). Current provider data unavailable." Never fall back to unlicensed sources. Never blend historical PriceCharting series with new provider series into a continuous chart; separate the two with a clear source attribution break.

4. **Price history**. `/v1/prices/{id}/history` = 3 credits/card. Would be fetched on-demand and cached locally for 7 days per card. For 1,000 unique card-view days/week × 3 cr = 12,000 cr/mo overhead.

5. **Base-card vs variant price separation** (critical). Per Phase 6 math above: TCGGraph's `raw_ungraded` and `psa10` are per-card-id aggregates. For variant-tagged PP rows (`[Sparkle]`, `[Reverse Holo]`, etc.) the provider value would be visibly WRONG. The activation rule must be:

   > A mapping with `tcg_printing_key != 'normal'` **cannot** be activated for raw-ungraded or PSA10 fields using TCGGraph's aggregate values. These rows either (a) remain on legacy data forever, (b) use TCGGraph's per-finish TCGplayer/Cardmarket market quotes (available), or (c) wait for TCGGraph to expose per-printing graded data (requested in licensing review).

### Phase-8 pre-reqs (operator homework before this is built)

- Confirm the external `card_trends` scraper identity + decommission plan.
- Decide PSA-9 UI policy (drop / relabel pooled as "Grade 9" / dual-pipe).
- Confirm licensing (§8).

---

## 8. Phase 9 — Licensing checklist (DRAFT; DO NOT SEND without operator approval)

Review target: <https://tcggraph.com/legal/terms>. Operator should read + confirm interpretation. **This repo did not fetch or inspect that URL.** No source rights are claimed as independently verified merely because API access works.

### Questions to send TCGGraph

1. **Public commercial display.** Our subscription grants API access. Does it also grant the right to publicly display the values on commercial Pokémon pricing sites (PokePrices and the other four Collector Network sites)?

2. **Five-site coverage under one subscription.** We have one Growth subscription. Is that single subscription a legal licence for all five Collector Network sites (`pokeprices.io`, `mtgprices.io`, `ygoprices.io`, `onepieceprices.io`, `lorcanaprices.io`) to display these values to end-users?

3. **Graded dataset source and sublicensing rights.** The `gradedPrices` responses are visibly identical to PriceCharting-era PokePrices realised-sales values on same-printing comparisons (see Phase 6 above). What is the ultimate source of the raw-ungraded and PSA/BGS/CGC/SGC-10 valuations? Is it an eBay realised-sales aggregation you perform, or do you license from a third party (e.g. PriceCharting, PWCC, GemRate)? Do our rights to display the valuations extend transitively to any upstream license?

4. **Pooled grade attribution.** TCGGraph exposes `grader: 'any', grade: '9/9.5/8/7'` only (pooled across PSA/BGS/CGC/SGC). We will label these as "Grade 9 (pooled)" or similar, never as "PSA 9". Please confirm the attribution requirement — does it require the "pooled across graders" phrasing to be visible on the page?

5. **Historical storage and retention.** Can we store the `/v1/prices/{id}/history` daily points indefinitely in our own database for serving chart surfaces, or must we TTL / re-fetch? If TTL, what?

6. **Attribution.** Do we need a visible "Powered by TCGGraph" badge, link, or footer line on pages that display these values? What is the required wording and placement?

7. **Card artwork rights.** TCGGraph serves card images at `cards.tcggraph.io`. Does our subscription include the right to hotlink those images from PokePrices? Or must we proxy / re-host? Does it include commercial display rights, or are these for internal/dev use only?

8. **Future SKU additions.** If you add a new TCG game, is it automatically covered under our Growth subscription, or do we need to opt in?

Operator approval required before sending.

---

## 9. Deliverables map

| Required | File | Status |
|---|---|---|
| Working protected matching workbench | `apps/hub/src/app/admin/pokemon-matching/*` | ✅ |
| Persistent approval and audit workflow | migration + `pokemon_tcg_mapping_audit` + action logging | ✅ |
| Improved promotional-set reconciliation | seed script + set aliases + baseCardId candidate linking | ✅ |
| Local candidate-matching engine | `scripts/pp-tcg-match-01-seed.mjs` | ✅ |
| Bulk-safe exact-match approval mechanism | `bulkApproveVerified` action with dry-run preview + confirm | ✅ |
| Recomputed Pokémon coverage | §2 above; verified-bulk-approvable **43,766 / 60,689 = 72.1%** | ✅ |
| Condition and grading field findings | §4 above; detail in `scripts/_pp-tcg-match-01/grading-probe.json` | ✅ |
| Explanation of original price divergence | §5 above; detail in `scripts/_pp-tcg-match-01/divergence-math.json` | ✅ |
| Exact current pricing-writer lineage | §6 above — external scraper repository, outside pokeprices-web | ✅ |
| Read-only preview of TCGGraph prices on approved mappings | per-card review page shows TCGGraph snapshot_prices in candidates panel | ✅ |
| Clear public cut-over plan, disabled pending approval | §7 — design only, migration placeholder table exists, no code path to live | ✅ |
| Remaining genuinely unmatched records, exported | `scripts/_pp-data-test-02/outputs/reconcile-rows.csv` filter by `match_status=unmatched` | ✅ |

### Credit accounting (session)

- Seed probing + grading probe + divergence math: **10 credits** (Phase 5 probe only; all other work used saved catalogues from PP-DATA-TEST-02)
- Remaining of the 300-credit cap for this ticket: **290**
- TCGGraph monthly remaining: **128,762 / 150,000**

---

## 10. How to use the workbench

1. Visit `/admin/pokemon-matching` (requires `network_admin_users` membership).
2. Review the metric cards — the eligible-bulk-approve figure is the headline KPI.
3. Click "Preview" on Bulk Approve to see the first 20 rows that would flip.
4. Click "Approve all verified pending" to commit — this is a one-shot bulk approval. Writes 43,766 audit rows. **Does not change live pricing.** Takes ~30 seconds.
5. Review individual cards via the queue table + Review button. Use filters to narrow by status/confidence/language or search by name/set/slug.
6. On the per-card page: approve current, reassign to a different candidate, reject, mark as "no TCG equivalent", or undo your last action.

Set aliases can currently only be added via SQL (operator admin table). An inline add-alias form is a reasonable V2 if the operator starts hitting PP sets that didn't resolve cleanly.

---

## 11. What's intentionally NOT in this build

- No live pricing changed. `card_trends` is untouched. PokePrices public pages render unchanged.
- No scheduled TCGGraph ingestion job created.
- No read-side feature flag.
- No automatic activation of approved mappings — the `activation_eligible` column stays `false` until a Phase-8 activation flow is explicitly built.
- No contact with TCGGraph. Licensing questions drafted, not sent.
- No tests written (hub has no test framework configured; this follows existing convention). Manual verification via admin pages after deploy.
- No other-site changes. Only `apps/hub` (shared admin) and shared Supabase were touched.
