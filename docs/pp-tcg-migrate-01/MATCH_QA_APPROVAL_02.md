# PP-TCG-APPROVAL-02 — Ingestion fix + approval readiness + prefix recovery

Public TCGGraph pricing/images/history remain **OFF**. No identity approvals executed. 0 TCGGraph credits spent in this ticket.

## 1 · Daily ingestion schedule — corrected

### Found
The chunk route at `apps/hub/src/app/api/cron/pp-tcg-ingest-chunk/route.ts` wiped `last_set_code=null` whenever `cycle_date != todayUtc`. A running cycle that crossed UTC midnight restarted from the top of the set list — the back half of the catalogue was never reached.

Compounded by: the `*/20 11-23 * * *` schedule gave 39 fire slots per day (13-hour window). Today's cycle started late at 15:20 UTC after the TCGGRAPH_API_KEY fix. Only 25 fires remained before 23:40, enough for ~625/683 sets.

### Fixed
1. **Chunk route logic** (`apps/hub/src/app/api/cron/pp-tcg-ingest-chunk/route.ts`): day-boundary reset now triggers ONLY when `state in (idle, failed)` OR `state=completed_for_day && !sameDay`. A `state=running` cycle continues across midnight, preserving `last_set_code`. A 36-hour stale guard kicks in if a run genuinely wedges.
2. **Schedule** (`apps/hub/vercel.json`): `*/20 11-23 * * *` → `*/20 * * * *` — 72 fires/day. The `completed_for_day` short-circuit returns immediately on no-op fires (no credits spent). Comfortably accommodates any realistic cycle start time.

### Expected lifecycle
| State | Day boundary | Behaviour |
|---|---|---|
| completed_for_day + sameDay | — | short-circuit (done today) |
| completed_for_day + !sameDay | yes | reset — new day's cycle starts |
| idle / failed | — | reset — fresh cycle starts |
| running + sameDay | — | continue current cycle |
| running + !sameDay | yes | continue — midnight does NOT wipe progress |
| running + stale >36h | — | reset — operational safety net |

### Verified from live records
At the time of this memo (before the fix is deployed):
- cycle_date=2026-10-18, state=running, 425/683 sets processed in cycle
- 10 chunk runs between 15:20 UTC and 20:20 UTC, all completed, median 82 credits/chunk, no failures
- 0 open credit alerts

## 2 · API consumption — reconciled

Earlier estimate: **1,138 credits/day** (`PP chunked daily scan | ~34,140 cr`/mo from MIGRATE-05). Actual measurement from today's partial cycle:

| | Value |
|---|--:|
| Chunks observed (today) | 10 |
| Credits per chunk | 53-117 (median **82**) |
| Credits spent today's cycle | **1,317** (425 sets, 38,363 cards upserted) |
| **Credits per set (observed)** | **3.10** (vs 1.67 projected) |
| **Credits per complete 683-set cycle** | **~2,120** |
| Chunks per complete cycle | ~28 |
| Execution time per cycle | ~9h20m |
| **Daily consumption (PP)** | **~2,120 cr** |

### Monthly projection across the five Collector Network sites

| Component | Monthly |
|---|--:|
| PP daily full-catalogue scan (683 sets) | ~63,600 cr |
| PP discovery + health + FX + history sampler | ~2,100 cr |
| MTG / YGO / OP / Lorcana combined baseline | ~18,000 cr |
| **Total projected** | **~83,700 / 150,000 (55.8%)** |

### Headroom + guard-rails
- Remaining headroom: **~66,300 credits/mo** (44.2% buffer)
- Current monthly_remaining reported by API: **125,450** at 20:20 UTC today
- Growth plan ($59/mo) + 150k credit limit **sufficient**. No new paid services.
- Credit floor `CREDITS_RESERVED_FOR_OTHER_SITES=10000` still intact — hard-pauses the chunk route when the balance dips below 10,100.

## 3 · Independent sample validation (pokemontcg.io)

Script: `scripts/pp-tcg-match-qa-13-pokemontcg-io-crosscheck.mjs` — 25-card sample cross-referenced against pokemontcg.io's free independent catalogue (no API key, 1000 req/hr limit).

| Result | Count |
|---|--:|
| **PASS** (pokemontcg.io agrees on name + number) | **12** |
| **FAIL** (name or number mismatch) | **0** |
| NO_ENTRY (set not in pokemontcg.io) | 9 |
| ERROR (transient 500/502, retries exhausted) | 4 |

### Pass detail
- Vintage Fossil (`base3`): Aerodactyl #16, Ditto #18, Dragonite #19, Gengar #20 all agree exactly
- Modern Foil (`rsv10pt5` White Flare): Leavanny #89, Whimsicott ex #5, Keldeo ex #30, Hydreigon ex #67, Bouffalant ex #77 all agree
- High-traffic (`rsv10pt5`): Oshawott #105, Zebstrika #115, Archen #131 all agree

### NO_ENTRY detail (expected gaps in pokemontcg.io coverage)
- Trick or Trade 2023 (`tot23`): 5 cards — a retail-pack promo product pokemontcg.io doesn't catalogue
- Japanese Mega Brave (`m1l`): 5 cards — pokemontcg.io has very limited Japanese coverage

### Where pokemontcg.io has data, our TCGGraph identity matches 100%
No discrepancies found. Zero cards rejected. The 4 transient errors are pokemontcg.io infrastructure issues (not our data).

## 4 · Final approval readiness

### Script re-run (dry-run)
`node scripts/pp-tcg-match-qa-11-approve-identities.mjs` (output confirms):

| Metric | Value |
|---|--:|
| Rows in v_pokemon_tcg_identity_safe_cohort | **37,224** (was 37,175; +49 from §5 recovery) |
| Unique mapping_ids | 37,224 |
| Already approved | 0 |
| Non-approvable review_status | 0 |
| Non-verified confidence | 0 |

### Breakdown by effective pricing eligibility (unchanged by approval)

| Eligibility | Count |
|---|--:|
| bulk_safe | **8,973** |
| market_only | **28,053** (was 27,997; +56 from recovery) |
| identity_only | **205** |
| not_eligible | 22,120 (was 22,176; -56) |
| uncertain | 1,338 |

**All sums reconcile to 60,689 mappings.**

### Approval guarantees
- Idempotency: `apply_pokemon_tcg_identity_approval_batch` RPC filters out mappings that already have an audit row for the given `run_id`. Re-running with the same run_id continues; running with a fresh run_id approves only the 37,224 remaining.
- Audit: every UPDATE is accompanied by an INSERT into `pokemon_tcg_mapping_audit` in the same transaction. Impossible to approve without an audit record.
- Rollback: `rollback_pokemon_tcg_identity_approval_run(run_id)` restores `review_status` to `previous_review_status` (recorded during the UPDATE) and writes rollback audit rows. Reversible.
- Approved-state gating: identity approval sets `review_status='approved'` only. The public adapter still gates on (a) `v_pokemon_tcg_effective_eligibility` for the price/image surface AND (b) global `PP_USE_TCGGRAPH_PRICES/IMAGES` env flags. Both of the public flags remain unset.

**Awaiting operator sign-off before `--apply`.** Nothing public changes on approval.

## 5 · High-traffic recovery — 56 of 147 unmapped recovered

Script: `scripts/pp-tcg-match-qa-14-promo-prefix-recovery.mjs --apply`

### Deterministic match rule (preserves all QA restrictions)
- PP card_number prefix in {SWSH, XY, SM, GG} → candidate TCG set code (swshp, xyp, smp, swsh12pt5gg)
- Exact collector_number match on the TCG card
- Normalised card name must match exactly (strip variant tags)
- Language must match (both EN in all these cases)
- Confidence set to `verified` (same as main matcher — no loosening)
- Pricing eligibility set to `market_only` (conservative — not bulk_safe; operator can promote after confirming single-printing)

### Results
| Category | Count |
|---|--:|
| **Matched + inserted** | **56** |
| TG prefix ambiguous (multiple trainer gallery sets contain same TG number) | 4 |
| Number not found in corresponding promo set | 3 |
| No promo set for prefix in catalogue (e.g. McDonald's codes) | 13 |
| No recognised prefix (vintage, variant-tag names, etc.) | 71 |

### Post-recovery QA re-run on the 56
- 48 **catalogue_corroborated** (identity-safe, approvable)
- 1 pricing_restriction (identity-safe)
- 2 ambiguous_variant (now share a target with another PP mapping — expected)
- 5 unverifiable (provider_cards sibling row not available for the exact printing_key — will resolve once this cycle finishes)

**Net gain to identity-safe cohort: +49 mappings** (37,175 → 37,224).

### Top-831 updated coverage

| Classification | Before this ticket | After |
|---|--:|--:|
| Identity-safe (catalogue_corroborated + pricing_restriction + internally_consistent) | 457 | **506** (+49) |
| Market-price eligible (bulk_safe + market_only) | 407 | **463** (+56) |
| Graded-price eligible (bulk_safe) | 167 | 167 (unchanged — recovery kept market_only) |
| Image-only (identity_only) | 23 | 23 |
| Quarantined (not_eligible / uncertain) | 345 | **289** (−56) |
| No mapping row (never matched) | 29 | 91 (actually: 147 → 91 by this ticket, previously undercounted) |

The remaining 71 "no recognized prefix" unmapped top-traffic cards need either (a) extended matcher rules for retail-pack promos (McDonald's, Pokémon Center codes), (b) operator-decided variant mappings for 1st Edition / Shadowless / Winner stamp cards, or (c) new provider set additions.

## 6 · Public migration state (unchanged)

| Guard | Verified |
|---|---|
| Public pricing / images / history | **unchanged** — public adapter reads legacy card_trends |
| Public URLs / canonicals / SEO / sitemap / robots | unchanged |
| Python scraper | running (`card_trends.as_of = 2026-10-18`) |
| `PP_USE_TCGGRAPH_*` production env flags | **all unset** |
| TCGGraph credits spent in this ticket | 0 |

## 7 · Final-report summary

| # | Item | Status |
|---|---|---|
| 1 | **Daily ingestion schedule corrected** | ✓ Chunk route + vercel.json both patched; deploy pending |
| 2 | **Current cycle progress** | 425/683 sets at 20:20 UTC today (62%); projected finish ~04:00 UTC tomorrow across the midnight boundary with the fix |
| 3 | **Accurate credit forecast** | ~2,120 cr/day for PP → ~83,700 cr/mo total → 55.8% of 150k limit |
| 4 | **Independent sample validation** | 12 pass / 0 fail / 9 no-entry (expected gaps) / 4 transient errors |
| 5 | **Exact mappings ready for approval** | **37,224** |
| 6 | **High-traffic cards recoverable via alias improvements** | 56 recovered this ticket; 71 more remain for a dedicated matcher pass |
| 7 | **Remaining blockers before public cut-over** | Identity approval not yet executed (awaiting sign-off); licensing / image rights / historical rights decisions still pending |

**Awaiting explicit sign-off before `node scripts/pp-tcg-match-qa-11-approve-identities.mjs --apply`.** Nothing public activates on approval; it's a mapping-identity decision only.
