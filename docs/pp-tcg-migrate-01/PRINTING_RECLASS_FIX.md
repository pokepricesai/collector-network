# PP-TCG-PRINTING-RECLASS-FIX — Completion report

Public TCGGraph flags remain **OFF**. All 18 pilot switches **OFF**. No indexed pages, SEO, scraper or URL changes.

## §1-§2 · Detection + non-destructive supersession

**Mechanism**: `pokemon_tcg_provider_cards.provider_status` column (`'active'` default | `'superseded'`). Side-car columns record WHY: `superseded_at`, `superseded_reason`, `superseded_by_printing_key`.

**Decision rule** (encoded in `scripts/pp-tcg-reclass-fix-01-detect-mark.mjs`):

1. Fully paginate `/v1/cards?set=X&language=Y` through to `hasMore=false` — **required** to classify. Partial response → the script throws `PAGINATION_INCOMPLETE` and marks nothing.
2. For each stored row with `provider_status='active'`:
   - `card_id` in API with the same `printing_key` → **legitimate active** (leave alone)
   - `card_id` in API but `printing_key` is NOT in API's printings list → **RECLASSIFIED** → mark `superseded`
   - `card_id` NOT in API at all → **leave active** (could be a provider deletion OR a page-edge; NOT marked by this fix per §2)

The third case preserves safety — a transient absence does not become a destructive flag. Operator-run review for any legitimate removal.

**Nothing is deleted.** The original row + all `pokemon_tcg_prices_market` + `pokemon_tcg_prices_graded` + historical price records remain addressable by `(card_id, printing_key)`.

## §3 · Read-path exclusion

- **Public adapter** (`pokeprices-web/src/lib/providerData/snapshot.ts`): now adds `.eq('provider_status', 'active')` to the `pokemon_tcg_provider_cards` lookup. Superseded rows cannot serve images or current prices on a public card page.
- **Matcher candidate generation**: no runtime matcher reads `pokemon_tcg_provider_cards` for live candidate proposal (only the one-off `scripts/pp-tcg-match-*` migration scripts touched it). Those are historical; no live-matcher change required.
- **Admin diagnostic pages** (qa-review, approval-samples): intentionally UNCHANGED. Operators need to see all rows for debugging context.
- Convenience view `v_pokemon_tcg_provider_cards_active` added for future readers.

## §4 · Three affected approved mappings — remap candidate analysis (NOT applied)

Per operator instruction: do not auto-remap. Full analysis per card:

### 1. `pp_card_slug=3461618` · **Darkrai EX #72** (Japanese EX Battle Boost)
- PP variant tag: **NONE**
- Currently mapped to: `pkm_ja_ebb_72 | normal` → **now `superseded`** (replaced by `foil`)
- TCGGraph's current active printing for this card_id: **`foil`** only
- QA: `pricing_restriction` (multi-printing graded unsafe), `single_printing=false`
- Market rows under old key (`normal`): 3 (preserved audit)
- Market rows under new key (`foil`): 1
- **Verdict**: CANDIDATE remap. PP has no variant tag, which lines up with TCGGraph's default-foil for EX cards. Remap would require re-running QA (siblings change, printing changes). **Not applied.**

### 2. `pp_card_slug=10366699` · **Drowzee [1st Edition] #40** (Japanese The Town on No Map)
- PP variant tag: `[1st Edition]`
- Currently mapped to: `pkm_ja_g23731_40 | 1st-edition` → **now `superseded`** (replaced by `normal`)
- TCGGraph's current active printing for this card_id: **`normal`** only
- QA: `catalogue_corroborated`
- **Verdict**: UNSAFE to auto-remap. PP identity requires the 1st-edition physical variant; the only active TCGGraph printing is `normal`. Mapping to `normal` would collapse an eligibility distinction PP preserves. Operator should decide: (a) retain the stale `1st-edition` superseded row and keep the mapping (reads will fail-closed on public), (b) remap and accept the identity drift, or (c) demote the mapping to `review_status='pending_review'` pending matcher re-run.

### 3. `pp_card_slug=10801470` · **Darkrai EX [1st Edition] #72** (Japanese EX Battle Boost)
- PP variant tag: `[1st Edition]`
- Currently mapped to: `pkm_ja_ebb_72 | 1st-edition` → **now `superseded`** (replaced by `foil`)
- TCGGraph's current active printing for this card_id: **`foil`** only
- QA: `catalogue_corroborated`
- **Verdict**: UNSAFE. Same as #2 — PP identity requires 1st-edition; TCGGraph only has `foil`. The same `card_id` is now the primary target for the no-variant Darkrai EX (card #1 above). Remapping would create a duplicate target with that mapping (`ambiguous_variant` territory). **Not applied.**

**Operator action table**:

| Mapping | Current public impact | Decision needed |
|---|---|---|
| Darkrai EX #72 | zero (public flags off) | re-QA + remap to `foil` is likely safe; defer to operator |
| Drowzee [1st Ed] #40 | zero | investigate TCGGraph reclassification validity; may need PP card retire or alternative mapping |
| Darkrai EX [1st Ed] #72 | zero | investigate; demoting mapping may be the cleanest option |

## §5 · 253 vs 63 reconciliation

The earlier memo cited "253 unexplained records" — that was an arithmetic shortcut taking (1,096 total 10-18 cohort) − (843 known seeding-gap). The correct arithmetic needs to also subtract the two `bw*|ja` overlap pairs (97 + 93 = 190 cards which are in sets stuck between migrate-01 and daily-10-18):

| Line | Value |
|---|--:|
| 1,096 daily-2026-10-18 total | 1,096 |
| − 843 seeding-gap (5 pairs: xyp\|ja + xy10\|ja + sv6\|ja + sm7\|ja + sm8\|ja) | -843 |
| − 190 split-cohort cards in `bw2\|ja` + `bw4\|ja` (overlap with the 404 migrate-01 cohort by set, not by card) | -190 |
| = **63 scattered records** across 46 pairs | **63** |

So "253" was my earlier shortcut math; the true scattered count was always 63. Documented and corrected.

## Marked superseded this ticket

- **20 (set, lang) pairs probed** across two runs (first 15 with 50-credit budget, next 5 with 25-credit cap)
- **26 provider_cards rows** marked superseded (18 + 8)
- **0 marked as "removed from provider"** (every orphan tested was a reclassification, not a deletion)
- **76 credits spent** total probing. Within one-off correction budget; monthly rate unaffected.

**26 remaining pairs** with 37 orphan rows are NOT yet probed (budget stopped). Pattern is 100% consistent — all probed orphans so far are reclassifications. The remaining 26 pairs can be processed by re-running the script with an operator-authorised additional 20-30 credit budget. **Not applied now** per the "small, targeted" scope.

## Pre- vs post-fix state

| Metric | Before | After |
|---|--:|--:|
| Total provider_cards rows | 79,472 | 79,472 (zero deletions) |
| `provider_status='active'` | n/a | **79,446** |
| `provider_status='superseded'` | n/a | **26** |
| Approved mappings pointing at a superseded row | 0 (column didn't exist) | **3** (reported in §4) |
| Pilot cohort mappings affected | — | **0** |

## §6 · Protected tests

`pokeprices-web/src/lib/providerData/__tests__/printingReclassification.test.ts` — 4 cases:

| # | Scenario | Expected |
|---|---|---|
| a1 | Superseded provider_card + pilot ON + flags ON | adapter returns `image_normal=null` (filtered out) |
| a2 | Superseded + prices still available in prices_market | adapter still gates image, graded suppressed by eligibility |
| b | Active row, same stub shape | adapter returns image + prices |
| c | Legacy stub without `provider_status` field | treated as active (back-compat) |

**69 providerData tests total** (65 → 69, +4 reclassification cases). All pass. Hub typecheck clean. PP-web typecheck clean.

### Not covered by tests (intentional, out of scope)
- `scripts/pp-tcg-reclass-fix-01-detect-mark.mjs` detection logic — guarded by:
  - `PAGINATION_INCOMPLETE` error on hitting page-20 cap (will not silently truncate)
  - `BUDGET_CAP` error on exceeding credit budget
  - Optimistic update filter `.eq('provider_status', 'active')` prevents double-marking

## Guard rails upheld

| | |
|---|---|
| Public TCGGraph flags | **OFF** |
| 18 pilot switches | **OFF** |
| Indexed card URLs / SEO / canonicals | unchanged |
| Python PriceCharting scraper | running |
| Deleted rows | **0** |
| Historical prices retained | ✓ (prices_market, prices_graded, prices_history untouched) |
| Approved mappings auto-remapped | **0** |

## Records still requiring operator review

1. **26 (set, lang) pairs with 37 orphan rows** not yet probed. Same reclassification pattern expected; needs ~20-30 cr budget to finish.
2. **3 approved PP mappings** (Darkrai EX #72, Drowzee [1st Ed] #40, Darkrai EX [1st Ed] #72) point at superseded rows. See §4 for per-card remap safety.
3. Tomorrow's 2026-10-20 full six-check verification — a separate ticket (as you noted).
