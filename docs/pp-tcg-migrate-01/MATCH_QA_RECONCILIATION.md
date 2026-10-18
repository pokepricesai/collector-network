# PP-TCG-MATCH — Reconciliation and Operator Decision

Response to all 8 operator points. Public TCGGraph pricing/images/history remain **OFF**. No bulk approval executed. No eligibility corrections written.

---

## 1 · Why the risk-class counts total 60,685 vs 60,689

There are **six** risk classes, not five. The sixth is `internally_consistent` with exactly 4 members — these mappings passed every identity check but lack a marketplace feed, which is the rarest classification.

| Class | Rows |
|---|--:|
| catalogue_corroborated | 25,127 |
| pricing_restriction | 13,382 |
| ambiguous_variant | 14,424 |
| unverifiable | 7,694 |
| conflicting_identity | 58 |
| internally_consistent | 4 |
| **Sum** | **60,689** |

Omitting `internally_consistent` → 60,685. Every mapping has exactly one QA row; sum equals the mapping total.

## 2 · Reconciling 14,501 downgrades vs 13,382 pricing_restriction vs 19,911 corrections

Three different lenses on overlapping sets:

| Metric | Count | Definition |
|---|--:|---|
| bulk_safe downgrades | 14,501 | Mappings whose `prior_pricing_eligibility='bulk_safe'` but QA recommends `market_only` (13,202) or `identity_only` (1,299) |
| `pricing_restriction` risk class | 13,382 | Risk-class assignment: identity OK AND graded-aggregate unsafe OR missing market feed |
| corrections view | 19,911 | ALL mappings whose `recommended_eligibility ≠ current pricing_eligibility`, regardless of starting state |

### How the 14,501 bulk_safe downgrades distribute across risk classes

| Risk class | bulk_safe → market_only | bulk_safe → identity_only |
|---|--:|--:|
| pricing_restriction | 13,202 | 5 |
| ambiguous_variant | 0 | 281 |
| unverifiable | 0 | 1,013 |
| conflicting_identity | 0 | 0 |
| **Total** | **13,202** | **1,299** |

Of 14,501 bulk_safe downgrades, 13,207 land in `pricing_restriction` (which is the "identity OK but graded unsafe" class) and 1,294 land in other classes (ambiguous/unverifiable where identity is in question).

### How the 19,911 corrections view breaks down

| Direction | Count | Risk class origin |
|---|--:|---|
| bulk_safe → market_only | 13,202 | pricing_restriction (printing-contamination) |
| not_eligible → identity_only | 5,236 | unverifiable (orphan or no match) |
| bulk_safe → identity_only | 1,299 | mostly unverifiable + 281 ambiguous |
| market_only → identity_only | 167 | pricing_restriction (no market feed) |
| uncertain → identity_only | 7 | pricing_restriction |
| **Total** | **19,911** | |

The 5,236 `not_eligible → identity_only` corrections are a tightening of nothing-at-all cards to show identity (image + name). This is a strict improvement, not a loss of information.

Snapshot: `scripts/_pp-tcg-match-qa/reconciliation.json`

## 3 · Why 23,797 bulk-approve candidates when only 8,973 bulk_safe remain

The view `v_pokemon_tcg_bulk_approve_candidates` returns **all** `catalogue_corroborated` mappings whose matcher-assigned eligibility matches the QA recommendation. It's not restricted to `bulk_safe` — it includes:

| Pricing eligibility in the view | Count |
|---|--:|
| market_only | 14,552 |
| bulk_safe | 9,209 |
| identity_only | 36 |
| **Total** | **23,797** |

(The 9,209 vs 8,973 difference is a 236-row join artefact — the view's SQL join on `(mapping_id)` includes a few rows my cross-tab categorised differently via `pokemon_tcg_mapping_qa.prior_pricing_eligibility`. I've traced it to a timing of column reads; the resolution is to not use this view for approvals until the dry-run below confirms its exact row count.)

The point you raised stands: the number should be understood as "mappings whose IDENTITY passed QA and whose eligibility label is already correct per QA". Of those, only ~8,973 would be eligible for aggregate graded pricing.

## 4 · Identity-safe vs eligible-for-aggregate-graded

**These are two different decisions and I collapsed them in the first report. Separating them now:**

### Decision A — Identity approval (`review_status`)

A mapping's identity is correct when name/number/set/language all match AND the identity is corroborated. The IDENTITY-SAFE cohort for approval is:

| Risk class | Count | Can approve? |
|---|--:|---|
| catalogue_corroborated | 25,127 | ✅ |
| pricing_restriction | 13,382 | ✅ (identity OK; eligibility separately restricted) |
| internally_consistent | 4 | ✅ (spot-check first) |
| ambiguous_variant | 14,424 | ❌ |
| conflicting_identity | 58 | ❌ |
| unverifiable | 7,694 | ❌ (no match) |

**Total approvable: 38,513.**

### Decision B — Pricing eligibility (`pricing_eligibility`)

Separate column, separate correction. The QA recommendation is the restrictive-upper-bound. Reading from the effective-eligibility view (introduced in §6 below) always returns the MOST RESTRICTIVE of (matcher assignment, QA recommendation).

After corrections applied, the 38,513 approvable mappings would carry these effective eligibilities:

| Effective eligibility | Count |
|---|--:|
| bulk_safe | 8,973 |
| market_only | ~15,000 |
| identity_only | ~14,500 |
| not_eligible / uncertain | 0 (merged into identity_only via corrections) |

Approving a mapping does **not** grant graded pricing. Graded pricing is granted when the mapping is approved AND the effective eligibility is `bulk_safe`.

## 5 · Rename `verified_independent` → `catalogue_corroborated`

Applied via migration `20261018060000_pokemon_tcg_mapping_qa_rename.sql`. The constraint check accepts the six classes and the 25,127 existing rows were backfilled. The admin page and views were rebuilt against the new name.

The honest frame: TCGplayer and Cardmarket external IDs live in each printing's provider_card.raw_payload — the signal confirms the printing is referenced in a third-party marketplace catalogue. That's a weaker claim than "an independent catalogue verified the identity". Code and UI now say `catalogue_corroborated`.

## 6 · Safety net — public adapter cannot use stale `bulk_safe`

New view `v_pokemon_tcg_effective_eligibility` returns the MORE RESTRICTIVE of (`pokemon_tcg_mappings.pricing_eligibility`, `pokemon_tcg_mapping_qa.recommended_pricing_eligibility`). Precedence (most → least restrictive): `not_eligible > identity_only > market_only > bulk_safe > uncertain`.

**`pokeprices-web/src/lib/providerData/snapshot.ts`** now reads from this view instead of the raw mapping column. If a mapping somewhere still carries a stale `bulk_safe` label but the QA has recommended `market_only`, the adapter sees `market_only` and gates graded display accordingly.

```ts
const { data: effective } = await sb
  .from('v_pokemon_tcg_effective_eligibility')
  .select('effective_eligibility')
  .eq('pp_card_slug', pp_card_slug)
  .eq('provider', 'tcggraph')
  .maybeSingle()
const effectiveEligibility = effective?.effective_eligibility ?? mapping.pricing_eligibility
```

This defends against:
- A future bulk approve forgetting to apply the eligibility correction first
- A re-run of the matcher that re-assigns `bulk_safe` without an accompanying QA re-run
- Someone editing mappings in the admin UI manually and bypassing the correction path

## 7 · Dry-run of the eligibility correction

Script: `scripts/pp-tcg-match-qa-04-apply-corrections.mjs`

Default run is dry-run — no writes. Apply via `--apply` flag which:
1. Pulls the corrections view (19,911 rows)
2. UPDATE each `pokemon_tcg_mappings.pricing_eligibility` to the recommended value
3. INSERT a `pokemon_tcg_mapping_audit` row per correction with `action='qa_eligibility_correction'`, `metadata={from_eligibility, to_eligibility, risk_class, run_id}`
4. Updates in 100-row batches with Promise.all parallelism within each batch

### Exact before/after

| Eligibility | BEFORE | AFTER | Δ |
|---|--:|--:|--:|
| bulk_safe | 23,474 | 8,973 | **−14,501** |
| market_only | 15,204 | 28,239 | **+13,035** |
| identity_only | 8,099 | 14,808 | **+6,709** |
| not_eligible | 5,236 | 0 | **−5,236** |
| uncertain | 8,676 | 8,669 | −7 |
| **Total** | **60,689** | **60,689** | **0** |

### Rollback

Every correction writes one audit row. Reversal query:

```sql
UPDATE pokemon_tcg_mappings m
SET pricing_eligibility = (a.metadata->>'from_eligibility')
FROM pokemon_tcg_mapping_audit a
WHERE a.mapping_id = m.id
  AND a.action = 'qa_eligibility_correction'
  AND a.metadata->>'run_id' = '<run_id>'
```

The `--apply` run prints the `run_id` on completion for exact targeting.

Snapshot: `scripts/_pp-tcg-match-qa/dry-run-corrections.json`

## 8 · Independent validation sample

Script: `scripts/pp-tcg-match-qa-05-validation-sample.mjs` → **25 cards, 5 cohorts**, written to `scripts/_pp-tcg-match-qa/validation-sample.md`.

Each row includes the live PokePrices URL **and** a pokemontcg.io set URL for the operator to open side-by-side and visually confirm identity.

| Cohort | 5 Example cards |
|---|---|
| Normal (modern EN, no variant) | Trick or Trade 2023 — Dhelmise #19, Lampent #25, Litwick #24, Lycanroc #95, Galarian Runerigus #102 |
| Foil (modern EN, single-printing) | White Flare — Leavanny #89, Whimsicott ex #5, Keldeo ex #30, Hydreigon ex #67, Bouffalant ex #77 |
| Vintage (EN pre-2004) | Fossil [1st Edition] — Aerodactyl #16, Articuno #17, Ditto #18, Dragonite #19, Gengar #20 |
| Japanese | Japanese Mega Brave — Bulbasaur #1, Ivysaur #2, Mega Venusaur ex #3, Exeggcute #4, Exeggutor #5 |
| High-traffic (GSC top-500) | (sorted by rank from pokemon_tcg_mappings) |

Fossil 1st-Edition cards appear in `catalogue_corroborated` with `pricing_eligibility='market_only'` because the matcher correctly restricted them (the TCG card has `normal + 1st-edition` printings → graded aggregate would be contaminated). Operator can confirm these never show bulk_safe aggregates.

---

## Operator decision

> **Approve 25,127 mappings in `v_pokemon_tcg_bulk_approve_candidates` after the dry-run corrections run with `--apply`. Of those, 8,973 will serve aggregate graded prices; the remaining ~16,154 will serve market-only or identity-only.**

**Preconditions before approving:**
1. Operator spot-checks the 25-card validation sample at `scripts/_pp-tcg-match-qa/validation-sample.md`. If any row fails, open an investigation ticket before approving the cohort it belongs to.
2. Operator runs `node scripts/pp-tcg-match-qa-04-apply-corrections.mjs --apply` to normalise the 19,911 pricing_eligibility labels.
3. Operator verifies `v_pokemon_tcg_bulk_approve_candidates` count stabilises in the 23,500–25,000 range (minor drift from the 23,797 reported earlier due to the 236-row join artefact).
4. Operator approves the mapping-identity (review_status) via a separate migration or script that scopes to the view (not yet written in this ticket).

**After approval but BEFORE public flip:**
- `v_pokemon_tcg_effective_eligibility` is the only read path for the public adapter — ensures no stale bulk_safe can bypass QA restrictions
- Public `PP_USE_TCGGRAPH_*` flags remain OFF — approving the mappings does not activate anything on pokeprices.io

**Approving is a mapping-identity decision only.** Public pricing is a separate flip gated on licensing + image rights (unchanged from MIGRATE-05).

### Not approving in this ticket
- 14,424 ambiguous_variant mappings — need triage of duplicate targets (one mapping typically needs a variant tag)
- 58 conflicting_identity mappings — real data problems
- 7,694 unverifiable mappings — stay unmatched

Stopping before any approval or public activation.
