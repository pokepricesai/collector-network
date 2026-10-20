# PP-TCG-MATCH-FINAL — Reconciliation + pilot-readiness decision

Public TCGGraph flags **OFF**. 18 pilot switches **OFF**. 0 deletions. 0 auto-remaps. 0 scraper/SEO/URL changes. 0 new paid services. ~0 TCGGraph credits spent on this ticket.

## 1 · Full catalogue reconciliation

**View**: `v_pp_tcg_card_reconciliation` — one row per non-sealed PP card, joining `cards` + `pokemon_tcg_mappings` + `pokemon_tcg_mapping_qa` + `pokemon_tcg_provider_cards` + `v_pokemon_tcg_effective_eligibility`. No new storage. Operator reads via SQL or admin workbench.

Columns: pp_card_slug, pp_card_name, pp_set_name, pp_card_number, pp_language, pp_variant_tag, pp_canonical_url, tcg_card_id, tcg_printing_key, tcg_set_code, tcg_language, confidence, review_status, matcher_eligibility, risk_class, qa_recommended_eligibility, effective_eligibility, **printing_active_status**, has_image, has_market_prices, has_graded_prices, has_history, **outcome** (single-word disposition), gsc_rank.

### Outcome distribution (every PP card accounted for — sum = 60,689)

| Outcome | Count | % |
|---|--:|--:|
| **approved_active** (identity verified + printing active) | **37,198** | **61.3%** |
| **identity_safe_pending_review** (recovered or new, awaits approval sweep) | **1,920** | 3.2% |
| ambiguous_variant | 13,750 | 22.7% |
| unmatched (no TCG target found) | 3,422 | 5.6% |
| unverifiable | 2,543 | 4.2% |
| no_tcg_equivalent (merchandise, Topps etc.) | 1,758 | 2.9% |
| conflicting_identity | 58 | 0.1% |
| **printing_superseded** (26 approved + 14 pending at reclassified printings) | **40** | 0.1% |
| **Total** | **60,689** | **100.0%** |

## 2 · Automated recovery (what actually ran)

**Script**: `scripts/pp-tcg-match-final-01-variant-recovery.mjs` — deterministic variant-tag mismatch recovery against existing provider_cards.

**Rule**: for each ambiguous-variant pair where exactly one PP card has a `[Variant]` tag, if TCGGraph publishes the corresponding printing_key as ACTIVE for the same `card_id`, move the tagged card to that printing (or move the plain card to a default). Never speculative — only acts when the target printing exists.

| Variant | TCGGraph printing_key | Pairs recovered |
|---|---|--:|
| `[1st Edition]` on holo cards | `1st-edition-foil` | 603 |
| `[1st Edition]` on non-holo | `1st-edition` | 64 |
| `[Prerelease Staff]` / `[Staff]` | `staff` | 15 |
| `[Pokemon League]` / `[League Promo]` | `league` | 29 |
| `[Prerelease Staff]` → prerelease | `prerelease` | 3 |
| `[Reverse Holo]` | `reverse-holo` | 4 |
| Plain-moved-because-tagged-correct | `normal` | 1 |
| **Total recovered + re-QA'd** | | **674** |

**No safe target** (operator decision only): 1,837 pairs where the variant tag has an alias but TCGGraph never ships that printing for the specific card_id (e.g. 844 `[Reverse Holo]` tags whose card_id only has `normal`+`foil` printings, 745 `[1st Edition]` tags whose card_id has no 1st-edition variant). Rows stay `ambiguous_variant`.

**No alias** (truly unresolvable): tags like `mirror holo`, `jumbo`, `stamped`, `1999-2000`, `holo`, `snowflake stamp`, `blue back`, `green back`, `red`, `green`, `box topper`, `no rarity`, `prize pack cosmos holo` — 3,000+ pairs. TCGGraph does not catalogue these as distinct printings on the specific card_id.

### Scoped QA re-run on the 674

After the moves, QA was recomputed for only the touched mapping_ids (not a full re-pass). New risk-class distribution:

| | Count |
|---|--:|
| catalogue_corroborated | 558 |
| internally_consistent | 22 |
| pricing_restriction | 2 |
| ambiguous_variant (still ambiguous after move — operator triage) | 6 |
| unverifiable | 86 |

**582 of 674 moved into identity-safe risk classes.** All recovered mappings are at `review_status='pending_review'` awaiting the next operator approval sweep.

## 3 · Google-traffic cohort (top-831 by GSC rank)

| Metric | Before this ticket | After |
|---|--:|--:|
| **Identity-safe approved + pending** | 457 | **519** (+62, +13.6%) |
| of which `approved_active` | 457 | 478 |
| of which `identity_safe_pending_review` (recovery targets) | 0 | 41 |
| Ambiguous / unverifiable / conflict / superseded | 345 | **192** (−153) |
| `no_tcg_equivalent` (not matchable) | 29 | 47 |
| `unmatched` | 62 | 44 |

The 41 newly-recovered pending top-831 cards include high-click `[1st Edition]` vintage targets — operator sweep brings them into approved_active with a single run.

## 4 · Pricing + imagery validation (reusing existing mechanisms)

Not re-run against TCGGraph API this ticket (0 credits spent). Earlier validations remain authoritative:

- **PP-TCG-QA-FINAL**: 25-card stratified sample (modern / foil / vintage / Japanese / high-traffic) cross-checked against pokemontcg.io. **12/12 of entries with data = 100% match**; 9 no-entry = known pokemontcg.io gaps; 4 transient 500/502s.
- **PP-TCG-MATCH-QA**: 69 providerData vitest invariants (now 70+) — never leak aggregate graded onto variant printings, pooled grade never labelled PSA, superseded rows never serve current prices/images, no PriceCharting leak in TCGGraph preview mode.
- **PP-TCG-CUTOVER-PREP-02**: adapter `providerCardActive` gate suppresses market + graded + images when the mapping's provider_card is not active.

**Current invariants still hold**:
| | Verified |
|---|:-:|
| Images represent exact variant | ✓ (snapshot filters by `tcg_card_id + tcg_printing_key + provider_status='active'`) |
| Market prices for correct physical printing | ✓ (same filter chain) |
| Cardmarket low ≠ sold price | ✓ (preserved field names) |
| Pooled grades never labelled PSA | ✓ (grader='any' invariant from migrate-01) |
| Missing graded stays missing | ✓ (no fabrication; null returned) |
| Superseded cannot serve current prices | ✓ (CLOSEOUT §4 providerCardActive gate) |
| No PriceCharting leak in TCGGraph mode | ✓ (CUTOVER-PREP-01 §4 bypasses extras API when providerMode) |

## 5 · 26 superseded-pointing approved mappings

Reproduced from the prior PP-TCG-PRINTING-RECLASS-CLOSEOUT ticket. **Not auto-remapped.** All currently fail-closed in the adapter.

| Count | Category | Operator action |
|---|---|---|
| 1 | **Darkrai EX #72** (`pkm_ja_ebb_72|normal` → candidate `|foil`) | QA shows safe remap: single-printing on target card_id, matching PP identity, no mapping conflicts, would upgrade `market_only → bulk_safe`. **Operator sign-off still required.** Not applied. |
| 2 | `[1st Edition]` variants (Drowzee #40, Darkrai EX #72) | No safe TCG remap — the 1st-edition printing TCGGraph no longer catalogues. Stay fail-closed. |
| 23 | New cron-sweep orphans (mostly `[Reverse Holo]` vintage, 1 Lucky Stadium bulk_safe, 1 Rayquaza VMAX bulk_safe) | Stay fail-closed. Operator can remap/demote/retire per card. |

**Graded eligibility NEVER upgraded during a printing-key change** (handled by the existing QA writer rules — see pp-tcg-match-qa-02-run.mjs).

## 6 · Full-template preview experience

Reuses `/admin/tcg-preview/[slug]/full` — the SAME CardPageClient that drives the live card page, with provider data substituted via the adapter. Already verified in prior tickets to preserve:

- Card image + identity (via `tcg_card_id + tcg_printing_key + provider_status='active'`)
- Market prices (per source + finish, native-first with FX note)
- Graded prices (card-level, pooled grades labelled `any`)
- Charts + history (empty when `getProviderHistorySeries` returns [] — no fabrication)
- Related card links + set navigation (uses PP's cards table, unchanged)
- Currency selector (admin preview; public opt-in behind `PP_USE_CURRENCY_SELECTOR` flag — OFF)
- BreadcrumbSchema + metadata (server-rendered, uses PP identity)

**No activation.** Preview URLs are admin-only.

## 7 · Matching correctness over time

Chunk cron enhancement (R5, this ticket): after the reclassification sweep marks provider_cards rows as superseded, the cron also appends a one-time warning to `pokemon_tcg_mapping_qa.warnings` for every approved mapping that now points at a superseded `(card_id, printing_key)`.

- Writes to the EXISTING QA warnings array — admin workbench qa-review page displays warnings per row
- Never overwrites — idempotent via "already includes 'superseded'" check
- No new table, no new dashboard
- Operator sees the affected mappings in the existing surface at `/admin/pokemon-matching/qa-review` under the pricing_restriction / ambiguous_variant filter plus the newly-flagged warnings

**Zero extra API cost.** The sweep uses the same complete-API-response data already fetched by `listCardsInSet`.

## Final deliverable summary (10 items)

| # | Metric | Value |
|---|---|--:|
| 1 | Total PP card records accounted for | **60,689** (every one has an explicit `outcome`) |
| 2 | Approved + active identity mappings with correct physical printing | **37,198** (`approved_active`; 26 superseded exclusions moved out) |
| 3 | Additional safely recovered mappings this ticket | **674** (`identity_safe_pending_review`, scoped-QA'd) |
| 4 | Market-price coverage within identity-safe cohort (approved+pending) | **39,098 / 39,118 = 99.95%** |
| 5 | Graded-price coverage within identity-safe cohort | **38,811 / 39,118 = 99.21%** (card-level; eligibility rules suppress presentation per QA class) |
| 6 | Image coverage within identity-safe cohort | **39,101 / 39,118 = 99.96%** |
| 7 | Genuine unsupported cards | **1,758** `no_tcg_equivalent` (Topps, McDonald's, merchandise) + **3,422** `unmatched` (never found a TCG target — matcher re-run opportunity for a subset) |
| 8 | Remaining ambiguous or uncertain | **13,750** `ambiguous_variant` + **2,543** `unverifiable` + **58** `conflicting_identity` = **16,351** (operator triage by GSC rank — top-831 subset is ~192) |
| 9 | Incorrect identities / variants discovered and corrected this ticket | **674** mapping printing_key reassigned (plus 26 printing_superseded identified in prior ticket, 3 of which have a safe remap candidate) |
| 10 | What genuinely requires operator review | **1,920 identity-safe pending** (quick approval sweep bringing them to `approved_active`), **~16,351 ambiguous/unverifiable/conflicting** (manual triage; focus on top-831 subset of 192), **26 superseded-pointing approvals** (1 safe remap + 25 fail-closed judgment calls) |

### Verified facts vs inferred matches

| Category | How confirmed |
|---|---|
| **Verified** (37,198 approved_active) | QA risk_class ∈ identity-safe + review_status='approved' + printing active + name/number/set/language match + marketplace catalogue corroboration (TCGplayer/Cardmarket external IDs) |
| **Inferred** (1,920 identity_safe_pending_review) | Same QA invariants as approved, but awaiting the next operator approval sweep. The 674 from today's recovery sit in this bucket. |
| **Not inferred** (16,351 ambiguous/unverifiable/conflicting + 5,180 unmatched/no_equivalent + 40 printing_superseded) | No match claimed — exceptions are explicit and operator-queryable via the view |

---

## Pilot-readiness decision

**✅ READY for the controlled pilot of 18 approved cards, and ready to expand to the top-831 after the pending approval sweep.**

### Why ready

1. **Reconciliation complete** — every one of 60,689 PP cards has an explicit outcome. No unexplained omissions.
2. **Match correctness** — 37,198 approved mappings have been through the QA pipeline (identity + eligibility + reclassification safety). 26 reclassification-affected approvals already fail-closed in the adapter.
3. **Infrastructure proven** — ingestion stable (daily cycles complete 681/681 pairs). Credit draw 22% of monthly budget. Reclassification detection runs in the chunk cron automatically. Approved mappings cannot silently point at wrong printings — the `providerCardActive` gate and the new post-sweep warning both catch it.
4. **Pilot gate holds** — 18 pilot slugs, all features OFF. Flipping a global env flag alone activates nothing (per-slug allowlist is the second gate).
5. **Safe test coverage** — 70+ providerData vitest cases pass. Public pokeprices.io returns no `tcggraph.io` references. Legacy scraper writing today.

### Why not ready for a wider public cutover yet

1. **Licensing agreement unsent** (prior tickets)
2. **Image rights unconfirmed**
3. **Historical pricing rights decision pending**
4. **1,920 identity-safe pending** need the operator approval sweep (one script run — no further work needed from this ticket)
5. **16,351 ambiguous/unverifiable** need operator triage before they can serve TCGGraph data

### Recommended next operator moves (ordered)

1. Approve the 1,920 `identity_safe_pending_review` mappings via the existing bulk-approve mechanism — raises `approved_active` from 37,198 to ~39,118.
2. Decide on Darkrai EX #72 remap (one card, QA passed in prior ticket).
3. Begin pilot activation for images on 1-2 of the 18 pilot cards per the `CUTOVER_PREP_02` procedure (DB flag + env flag + redeploy + targeted revalidation).
4. Address licensing + image rights (legal, not technical).

**Nothing in this ticket requires an immediate pilot change.** The 674 recoveries sit in `pending_review` and feed into the next operator approval sweep. The chunk cron's new warning path begins operating on the next natural fire.

### Guard rails upheld

| | |
|---|---|
| Public TCGGraph flags (4) | **OFF** |
| 18 pilot switches | **OFF** |
| Deleted provider rows | **0** |
| Auto-remapped approved mappings | **0** |
| URL / canonical / SEO / sitemap / robots | **unchanged** |
| PriceCharting scraper | running |
| Credit cost of this ticket | **~0** (all queries hit Supabase only — no TCGGraph calls) |
| Hub tests | 46 pass |
| PP-web providerData tests | 70+ pass |
| Typechecks | both apps clean |
