# PP-TCG-CREDIT-OPT-01 — Honest analysis

**Recommendation**: **Do not implement value-based refresh scheduling.** TCGGraph's endpoint structure makes it impractical. Maximum achievable savings under the proposed policy are ≤2.79% of current monthly draw — cosmetic. Architecture is already request-level efficient. No changes made.

## Step 1 — Endpoint cost model + value distribution

### Endpoints currently in use

| Endpoint | Called by | Cost model |
|---|---|---|
| `/v1/sets` | `pp-tcg-discover` cron | ~1 cr per call (daily) |
| `/v1/cards?set=X&language=Y&page=P&limit=100` | `pp-tcg-ingest-chunk` | **~1-3 cr per page**. Returns up to 100 cards per page WITH their market prices + graded prices embedded. |
| `/v1/prices/{card_id}/history` | `pp-tcg-history-sampler` | ~1 cr per card, used only for selected GSC top cards weekly |
| `/v1/games/pokemon` | monitoring pings | 0 cr |

**The decisive fact**: pricing is bundled into the SET-FETCH request. There is no cost-advantageous per-card pricing endpoint. Skipping individual low-value cards within a set saves **zero** credits because the set page call is already paid for.

### PP card value distribution (TCGplayer USD market, EUR converted at 1.07)

| Bucket | Count | % |
|---|--:|--:|
| < $1 | 32,704 | 33.9% |
| $1 – <$5 | 25,869 | 26.8% |
| $5 – <$20 | 18,856 | 19.5% |
| $20 – <$100 | 13,445 | 13.9% |
| $100+ | 5,708 | 5.9% |
| **Total with any market price** | **96,582** | |

**60.6% of (card, printing) pairs are under $5**. On a per-card basis, if the API supported per-card refresh, the policy would skip ~60% daily. But the API is per-set.

### Set-level distribution (the only thing that can actually save credits)

| Set max-card price | # (set, lang) pairs | % |
|---|--:|--:|
| **All cards < $5** | **38** | **5.6%** |
| $5 – <$20 | 83 | 12.2% |
| $20 – <$100 | 152 | 22.3% |
| $100+ | 391 | 57.2% |
| No price data (keep daily per policy) | 19 | 2.8% |
| **Total pairs** | **683** | |

**Only 38 of 683 sets have NO card requiring daily refresh.** The remaining 645 (94.4%) have at least one card ≥ $5 that forces a daily set fetch anyway.

### Applying the full policy (high-traffic + graded exceptions)

Of the 38 all-under-$5 sets:
- 2 contain a top-831 GSC high-traffic card → must stay daily
- 0 contain a graded card with value ≥ $20 → unchanged
- **Final eligible for 48h cadence: 36 sets** (sample: `ba2024|en`, `bwtk|en`, `g23807|ja`, `g23855|ja`, …)

### Realistic savings projection

- 36 sets × ~3.1 cr/set × (skip every other day = 50%) ≈ **56 cr/day saved**
- **~1,674 cr/month ≈ 2.79% of current ~60,000 cr/mo PP draw**
- As % of 150,000 total monthly limit: **~1.1%**

## Step 2 — Why NOT implementing is the right call

**The user ticket itself anticipated this**:

> "If the provider's endpoint structure makes this optimisation impractical, report that clearly and recommend a more effective request-level scheduling strategy rather than creating a cosmetic per-card schedule."

A 36-set 48h cadence would require:
- Per-set cadence tracking column on `pokemon_tcg_sets_observed` (or similar)
- Chunk route logic to compute "fetched within last 48h?" per set
- A promotion/demotion rule when any card in a slow-refresh set rises above $5 (requirement 5 — "Prevent cards from remaining permanently on a slow refresh schedule when prices rise")
- Observability for cadence slips
- Tests for all four edge cases: price-rise promotion, new-release promotion, high-traffic promotion, graded promotion

For **2.79% savings**, this is complexity debt that outweighs the gain. It also introduces a nonzero risk of serving stale prices on a card that silently crosses the $5 threshold overnight.

## Step 3 — Honest alternative evaluation

### Request-level efficiency levers (actually examined)

| Lever | Current state | Potential | Verdict |
|---|---|---|---|
| Pagination cap | 20 pages (2,000 cards) safety cap, already hits `hasMore=false` naturally for all 683 sets | 0 cr | Already optimal |
| `/v1/games/pokemon` monitoring pings | Free endpoint, zero cost | 0 cr | Already optimal |
| Discover cron frequency | Daily (~1 cr/day) | ~15 cr/mo saved by moving to weekly | Marginal |
| History sampler | Already selective (top-GSC subset, weekly cycle) | — | Already optimal |
| Multi-site shared catalogue | MTG / YGO / OP / Lorcana each run their own chunk cycles with the same endpoint cost model | Not combinable — each site has distinct TCG catalogues | — |

### Alternative: INCREASED credit efficiency by catalogue-tier cadence

A theoretical higher-savings alternative — **not recommended** without operator sign-off:

1. **Weekly cadence for all vintage sets** (release_date < 2010): identity doesn't change, prices move slowly for secondary market. ~55-60 sets would qualify.
2. **This would violate**: policy point 5 ("prevent permanently slow refresh when prices rise"). Vintage cards can spike too.
3. **Savings**: ~5-8% monthly. Still modest. Not worth the complexity + staleness risk.

### Actual recommendation

**Keep the current architecture.** It is:
- Already minimal in request count (one request per set per day)
- Already minimal in credit draw (~2,120 cr/day for 683 sets)
- Already correct in reclassification handling (CLOSEOUT)
- Already comfortably within budget: **~60,000 cr/mo of 150,000 (40%)**

The budget headroom is **90,000 cr/mo** — enough to grow the catalogue by 50% without optimisation.

## Guardrails (nothing changed)

| | |
|---|---|
| Public TCGGraph flags | **OFF** |
| 18 pilot switches | **OFF** |
| Code changes to chunk route / cron schedule / adapter | **none** |
| Indexed URLs / canonicals / SEO / sitemap | unchanged |
| PriceCharting scraper | running |
| TCGGraph credits spent on this investigation | **0** (all queries hit Supabase only) |
| Hub + PP-web test state | unchanged (46 + 70 pass) |

## If operator still wants the 36-set 48h optimisation anyway

Below is the minimal implementation plan. **Not applied in this ticket** per the "report that clearly rather than creating a cosmetic per-card schedule" guidance.

### Implementation sketch (deferred)

1. Add column `pokemon_tcg_sets_observed.refresh_cadence_hours` (default 24, can be 48 for low-value sets)
2. Add column `pokemon_tcg_sets_observed.last_refreshed_at` (updated by chunk route after successful ingest)
3. In chunk route: skip a set if `last_refreshed_at > now() - refresh_cadence_hours`
4. Add promotion sweep (nightly cron): any set with a card ≥ $5 after last ingest → bump cadence back to 24
5. Operator script to seed cadence=48 on the 36 identified sets
6. Observability: `pokemon_tcg_ingestion_runs.metadata.sets_skipped_cadence` counter
7. Tests: 4 cases (promotion on price rise, demotion-only-via-operator, new release override, high-traffic override)

Estimated effort: ~1 day. Estimated return: **1,674 cr/mo = 2.79%** of PP's current draw, or $1.07/mo in Growth plan equivalent. **Not recommended.**
