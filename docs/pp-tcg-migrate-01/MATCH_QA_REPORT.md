# PP-TCG-MATCH — Automated QA Report

Public TCGGraph pricing/images/history remain **OFF**. No bulk approval executed. 0 TCGGraph credits spent.

## 1 · Full-cohort automated QA results

Automated QA ran over **all 60,689** mappings (not just the 23,474 bulk_safe candidates). Each mapping evaluated against 10 deterministic checks + 2 independent-evidence signals.

### Risk-class distribution

| Class | Count | % | Operator action |
|---|--:|--:|---|
| `verified_independent` | 25,127 | 41.4% | Safe to bulk approve |
| `internally_consistent` | 4 | 0.0% | Spot-check |
| `ambiguous_variant` | 14,424 | 23.8% | Review — duplicate target |
| `conflicting_identity` | 58 | 0.1% | Review — real data problem |
| `pricing_restriction` | 13,382 | 22.1% | Apply downgrade, then approve |
| `unverifiable` | 7,694 | 12.7% | Investigate or leave unmatched |

### Prior vs recommended pricing_eligibility

| Prior | Recommended | Count | Change |
|---|---|--:|---|
| bulk_safe | bulk_safe | 8,973 | kept — single printing + market feed OK |
| bulk_safe | market_only | 13,202 | **downgrade** — multi-printing graded aggregate unsafe |
| bulk_safe | identity_only | 1,299 | **downgrade** — no market feed or hard identity miss |

**91.0% of mappings** have an independent marketplace reference (TCGplayer or Cardmarket external ID present on the printing's provider card).

Full summary: `scripts/_pp-tcg-match-qa/qa-summary.json`

## 2 · Printing & graded-price eligibility findings

The pre-existing `pricing_eligibility='bulk_safe'` flag answers "is the matcher's identity confident enough to pool graded prices?" at the MATCHER level. It does not consider whether the TCG card's graded aggregate itself is contaminated by sibling printings. The TCGGraph `pokemon_tcg_prices_graded` table is keyed by `(provider, tcg_card_id, grader, grade)` — **no printing dimension**. If the base card has multiple printings (normal + reverse-holo + pokemon-center + sparkle + prize-pack), the graded aggregate pools sales across all of them.

### Investigation of operator-cited examples

| Card | Chosen printing | Siblings on TCG card | Verdict |
|---|---|---|---|
| **Iron Treads ex #143** | `foil` | `foil`, `pkm_pps_143_198` (a second printing) | **UNSAFE** — correctly flagged `pricing_restriction` by QA |
| **Penny #239** | `foil` | `foil` (single printing) | SAFE — stays verified_independent |

### Headline

Of the 23,474 pre-existing bulk_safe mappings:
- **10,132 (43.2%)** genuinely safe — TCG card has exactly one printing
- **13,342 (56.8%)** RISKY — TCG card has multiple printings, graded aggregate contaminated
  - 11,095 have a known variant sibling (`pokemon-center`, `reverse-holo`, `prize-pack`, `sparkle`, `jumbo`, `stamped`, `glossy`, `shadowless`, `first-edition`, etc.)
  - 2,247 have non-variant multi-printing (two "normal" variants exist, e.g. different language-promo codes on same base card)

The QA automatically **recommends downgrading these 13,342 mappings** from `bulk_safe` to `market_only` (or `identity_only` where the market feed is also missing).

## 3 · New operator review interface

**`/admin/pokemon-matching/qa-review`** replaces the old 40-sample flow.

### What the operator sees per mapping
- **PokePrices image** (left column) via `cards.image_url` from shared Supabase
- **PokePrices identity** panel: name, set, number, language — exact field-by-field comparison against TCGGraph
- **TCGGraph identity** panel: card_id, printing_key, name, set, number, language
- **Sibling printings callout** — rendered as a yellow warning box listing every printing on the TCG card, with explicit "card-level graded aggregate is contaminated by sibling printings" copy
- **TCGGraph image** (right column) via `pokemon_tcg_provider_cards.image_normal`
- **Independent-evidence badges**: TCGplayer ✓/—, Cardmarket ✓/—, image ✓/✗, market ✓/✗
- **Prior → recommended eligibility** with the delta highlighted
- **Warnings bar** across the bottom with all QA-generated reasons

### Filter + navigation
Risk-class tabs show counts per class. Default view = `pricing_restriction` (highest-value operator work). Each class filter paginates in 25-row chunks. Mismatched fields are rendered in red so the operator can scan a page without reading every row.

### What was removed
The old `/admin/pokemon-matching/approval-samples` page kept its 40-sample workflow but is now labelled "Legacy sample review" below the primary "Automated QA review →" link on the main admin page. Not deleted — it's the record of what was in place before this ticket.

## 4 · Recommended safe bulk-approval cohort

**View: `v_pokemon_tcg_bulk_approve_candidates`** — mappings that passed every check:

```sql
risk_class = 'verified_independent'
AND review_status IN ('pending_review', 'unmatched')
AND confidence = 'verified'
AND recommended_pricing_eligibility = current pricing_eligibility
```

**Count: 23,797 mappings.**

These are the mappings where:
- Name, set, number, language all exact match between PP and TCG
- At least one of TCGplayer or Cardmarket has the printing in its catalogue
- An image is available
- A market price feed is active
- Graded pricing is either safe (single printing) OR not applicable (already market_only / identity_only on both sides)
- The QA pass agrees with the matcher's pricing_eligibility — no correction needed

**View: `v_pokemon_tcg_pricing_eligibility_corrections`** — the inverse (19,911 rows). These need the recommended eligibility applied FIRST before any bulk-approve run touches them. Applying the correction keeps the mapping intact — only the eligibility label changes.

### Suggested operator sequence

1. Visit `/admin/pokemon-matching/qa-review?class=pricing_restriction` — spot-check 20–30 cards across sets, confirm the sibling-printing warning triggers on real multi-printing cards.
2. Spot-check 20–30 cards from `/admin/pokemon-matching/qa-review?class=verified_independent` to confirm the clean path renders real evidence (image, name, number, set all match).
3. Run a separate migration or script to apply the 19,911 recommended eligibility corrections to `pokemon_tcg_mappings.pricing_eligibility`. These remain `review_status='pending_review'` — eligibility is a label change, not an approval.
4. Bulk approve the 23,797 verified_independent + eligibility-aligned cohort by scoping the resumable batch to `WHERE id IN (SELECT mapping_id FROM v_pokemon_tcg_bulk_approve_candidates)`.
5. For the remaining 14,424 `ambiguous_variant` + 58 `conflicting_identity` + 7,694 `unverifiable` — these stay unapproved and will cycle through operator review in the QA interface by risk class.

## 5 · Exceptions needing human attention

| Class | Count | Why it needs a human |
|---|--:|---|
| `ambiguous_variant` | 14,424 | ≥2 PP mappings target the same `(tcg_card_id, printing_key)` — one of them is likely missing a `[Variant]` tag or pointing at the wrong printing |
| `conflicting_identity` | 58 | Hard mismatch on ≥2 of {name, number, set} — may be a mis-match that slipped through verify-confidence |
| `pricing_restriction` | 13,382 | Identity is correct, but applying the recommended eligibility downgrade changes the pricing surface — operator should authorise the batch correction |
| `unverifiable` | 7,694 | Mapping has no `tcg_card_id` — these are already outside bulk_safe and will remain legacy-source-only |

Only the 13,382 `pricing_restriction` are a mass batch (apply a label change). The 14,424 `ambiguous_variant` + 58 `conflicting_identity` are the irreducible human review surface — one-by-one triage.

## 6 · Preservation of production safety

Checked at report time:

| Guard | State |
|---|---|
| Public pricing (card page) | **unchanged** — reads legacy `card_trends` |
| Public images | **unchanged** — legacy image URLs |
| Public historical graphs | **unchanged** |
| Public URLs / canonicals / sitemap / robots | **unchanged** |
| Legacy Python scraper | **running** (08:00 UTC nightly) |
| `PP_USE_TCGGRAPH_*` env flags | **all unset** in production |
| Mapping `review_status` writes | **zero** — no automatic approval |
| TCGGraph API credits | **0** this session |

The QA script reads from Supabase only. The admin review page reads shared Supabase + hotlinks PP image URLs that already serve from the public PP CDN. No external API traffic.

## 7 · Honest statement about independent evidence

**The ticket asks for independent catalogue cross-reference.** This QA uses TCGplayer / Cardmarket external IDs embedded in the printing's provider card as independent corroboration — those IDs exist only when the printing is listable at a real third-party marketplace. 91% of mappings have at least one.

A stronger independent cross-check against **pokemontcg.io** (free API, no key required, independent of TCGGraph) was scoped out of this ticket to keep the automated run durable without external API dependencies. Wiring that in would raise the signal on `verified_independent` from "internally matched + external listing exists" to "internally matched + external listing exists + independent catalogue agrees on name/number/set/release". The current QA output flags this correctly: the `verified_independent` class should be read as "internally-matched with marketplace catalogue corroboration" rather than "externally cross-checked identity".

## 8 · Deliverables summary

| Deliverable | Artifact |
|---|---|
| Full-cohort automated QA results | `pokemon_tcg_mapping_qa` table — 60,689 rows |
| Risk categories and exact counts | §1 above + `scripts/_pp-tcg-match-qa/qa-summary.json` |
| Printing & graded eligibility findings | §2 above + `scripts/_pp-tcg-match-qa/foil-risk.json` |
| Useful visual review interface | `/admin/pokemon-matching/qa-review` |
| Recommended safe bulk-approval cohort | `v_pokemon_tcg_bulk_approve_candidates` (23,797 rows) |
| Exact exceptions needing human attention | §5 above — three categories, scoped to risk class |

### Guard rails upheld
- No mappings approved automatically
- No public TCGGraph read-path flipped
- No URLs / SEO / scraper changed
- 46 hub vitest cases pass
- Hub + PP-web typechecks clean
- 0 TCGGraph credits spent this session

Stopping before bulk approval or any public activation.
