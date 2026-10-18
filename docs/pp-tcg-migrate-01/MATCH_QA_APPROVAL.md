# PP-TCG-APPROVAL Memo

Response to the 7 operator items. Public TCGGraph pricing/images/history remain **OFF**. No identity approvals executed. 0 TCGGraph credits spent in this ticket.

---

## 1 · Correction-run reconciliation (30,314 vs the 19,911 estimate)

The two counts measure **different QA-recommendation sets**:

- **19,911** = corrections view before the §1 quarantine policy fix. Treated ambiguous/unverifiable/conflicting rows as `identity_only` upgrades.
- **30,314** = corrections view after the quarantine policy fix. Those categories now go to `not_eligible` (image surface locked down).

### Row-level accounting (30,314 − 19,911 = 10,403)

**Removed from old view** (now not_eligible = prior, so no correction needed):
| Pattern | Rows |
|---|--:|
| not_eligible → identity_only (unverifiable, wrong upgrade) | 5,236 |
| uncertain → identity_only (pricing_restriction, wrong upgrade) | 7 |
| **Removed total** | **5,243** |

**Added by new view** (quarantine moves not present before):
| Pattern | Rows |
|---|--:|
| identity_only → not_eligible (ambig+unver) | 8,066 |
| uncertain → not_eligible (ambig+unver+confl) | 7,338 |
| market_only → not_eligible (ambig+unver) | 242 |
| **Added total** | **15,646** |

**Direction-changed rows** (same mapping, new target):
| Pattern | Rows |
|---|--:|
| bulk_safe → identity_only (unverifiable) **became** bulk_safe → not_eligible | 1,013 |
| bulk_safe → identity_only (ambiguous_variant) **became** bulk_safe → not_eligible | 281 |

Verification: 19,911 − 5,243 + 15,646 = **30,314** ✓

**No corrections repeated.** The run_id `qa-correction-2026-10-18T19-31-24-726Z` is `completed`, 30,314 of 30,314 applied, 30,314 audit rows written. Final classifications and adapter fail-closed rules unchanged.

## 2 · Identity approval — ready for sign-off

### Dry-run results (`scripts/pp-tcg-match-qa-11-approve-identities.mjs`)

| Metric | Value |
|---|--:|
| Rows in `v_pokemon_tcg_identity_safe_cohort` | **37,175** |
| Unique mapping_ids | **37,175** (0 duplicates) |
| Already approved | 0 |
| Non-approvable review_status | 0 |
| Non-verified confidence | 0 |
| **Would be approved on --apply** | **37,175** |

### Risk-class breakdown
| | |
|---|--:|
| catalogue_corroborated | 23,797 |
| pricing_restriction | 13,375 |
| internally_consistent | 3 |

### Matcher pricing_eligibility (what the public adapter will serve after approval)
| | |
|---|--:|
| bulk_safe | 8,973 |
| market_only | 27,997 |
| identity_only | 205 |

### 20-sample operator check
Printed to stdout on each dry-run. Mix of modern bulk_safe (`Inteleon V #119`, `Scizor V #183`, `Flapple #210`, `Cynthia's Garchomp ex #111`), reverse-holo market_only (`Blastoise [Reverse Holo] #37`, `Wingull [Reverse Holo] #77`), vintage pricing_restriction (`Ninetales [Shadowless] #12`). No surprising entries.

### Approval infrastructure
- Migration `20261018090000_pokemon_tcg_identity_approval_run.sql` — `pokemon_tcg_identity_approval_runs` table + `apply_pokemon_tcg_identity_approval_batch` RPC + `rollback_pokemon_tcg_identity_approval_run` RPC. Mirrors the correction-run design: run_id persisted before writes, UPDATE + audit INSERT atomic in a single plpgsql transaction, resumable on crash via "no audit row for this run_id" filter, reversible via rollback RPC.
- Script `scripts/pp-tcg-match-qa-11-approve-identities.mjs` — `--apply` to execute, `--apply --run <id>` to resume, `--rollback <id>` to revert.

### Approval is INDEPENDENT of pricing eligibility
Approving a mapping sets `review_status='approved'`. The public adapter still gates on `effective_eligibility` from `v_pokemon_tcg_effective_eligibility` AND on the global `PP_USE_TCGGRAPH_PRICES/IMAGES` env flags. Neither of those flags is set; approval alone does not activate public display.

**Awaiting your explicit sign-off before --apply.**

## 3 · High-traffic recovery — diagnosis of 345 quarantined + 29 unmapped

Script: `scripts/pp-tcg-match-qa-12-high-traffic-recovery.mjs`. Top-831 ordered by `commercial_rank` (GSC 90-day click rank, 1 = most clicked).

### Diagnosis counts (345 quarantined mappings in top-831)
| Primary reason | Rows |
|---|--:|
| duplicate_printing_target (ambiguous_variant) | 189 |
| no_mapping (unverifiable, no `tcg_card_id`) | 147 |
| orphan_provider_card (unverifiable, card_id missing from provider_cards) | 9 |
| **Total diagnosed** | **345** |

Secondary signals observed across those rows: 141 have multi-printing siblings on the TCG card (`siblings` tag), 111 have a `[Variant]` tag the matcher mis-parsed.

### Top-10 highest-click quarantined (by GSC rank)
| Rank | Risk | Card | Why |
|--:|---|---|---|
| 3 | unverifiable | Poke Pad #113 | orphan_provider_card — tcg_card_id doesn't exist in provider_cards |
| 5 | unverifiable | Greninja [Gold Star] #SWSH144 | no_mapping — matcher never resolved the SWSH-prefix code |
| 7 | ambiguous_variant | Gengar #50 | 6 sibling printings including GameStop/EB Games cosmos holo variants |
| 10 | ambiguous_variant | Pikachu Birthday #24 | duplicate_printing_target |
| 16 | unverifiable | Reshiram #XY74 | no_mapping — XY-prefix promo code |
| 17 | unverifiable | Garchomp V #TG23 | no_mapping — TG-prefix (Trainer Gallery) subset |
| 18 | ambiguous_variant | Nidoking [1999-2000] #11 | variant tag matcher didn't know |
| 19 | ambiguous_variant | Houndoom [Double Holo Error] #8 | variant tag matcher didn't know |
| 20 | ambiguous_variant | Charmander #20 | 4 siblings incl. energy-symbol / friendball / mcap |
| 22 | unverifiable | Giratina VSTAR #GG69 | no_mapping — GG-prefix (Galarian Gallery) subset |

### Why I did NOT auto-fix any of these

None of these have deterministic evidence sufficient for a safe automatic resolution under the operator's rule *"do not loosen pricing safety to increase match percentages"*:

| Category | Why not auto-fixable in this ticket |
|---|---|
| **189 ambiguous_variant** | Two PP cards claim the same (card_id, printing_key). Fixing one requires choosing which PP variant tag maps to which TCG printing_key — a matcher-rule decision, not deterministic evidence. |
| **147 no_mapping** | Matcher never found an entry. Many have SWSH/XY/SM/TG/GG prefixed codes — the matcher's set-code alias table doesn't currently handle these subsets. Fixing requires adding aliases + re-running the matcher. |
| **9 orphan_provider_card** | Mapping references a `tcg_card_id` not in `pokemon_tcg_provider_cards`. Could be stale ingestion data or a provider catalogue change. Safe to null + re-match, but that still leaves them unmatched — not a recovery. |
| **29 completely unmapped** | PP cards with no mapping row at all. Requires a dedicated matcher pass; outside this ticket's scope and not in the current data (commercial_rank lives on `pokemon_tcg_mappings`, which these don't have). |

### Before / after coverage of the top-831

| Category | Before | After (unchanged in this ticket) |
|---|--:|--:|
| **Identity-safe (approvable)** | 430 | 430 |
| **Market-price eligible** (bulk_safe + market_only) | 407 | 407 |
| **Graded-price eligible** (bulk_safe) | 167 | 167 |
| **Image-only** (identity_only) | 23 | 23 |
| **Quarantined** (ambig + confl + unver) | 345 | 345 |
| **No mapping row** | 29 | 29 |

**Recommended next tickets** (ordered by expected impact):
1. **Matcher extension for SWSH/XY/SM/TG/GG promo codes** — a single alias-table update plus a scoped matcher re-run would resolve ~100 of the 147 no_mapping cards. These are mostly English promo subsets with a known 1:1 relationship to TCG set codes.
2. **Operator triage UI for ambiguous_variant** — surface the paired PP mappings side-by-side with printing-key options. 189 pairs = ~95 decisions. Each decision resolves one PP card into the identity-safe cohort.
3. **29 completely unmapped** — needs a dedicated matcher pass combined with GSC data export + set-alias additions.

## 4 · Ingestion status (post API-key fix)

Live DB query against `pokemon_tcg_ingestion_runs` + `pokemon_tcg_ingestion_cursor` at the time of this memo:

- **Cursor state**: 350 of 683 sets processed this cycle (**51.2%**), 35,612 cards upserted, cycle_date=2026-10-18, state=running
- **Last 10 runs**: all `completed`. First successful post-key-fix run began 16:40:25 UTC on `*/20` cadence.
- **Credits per run** (last 10): 53, 53, 57, 69, 107, 81, 81, 115, 117, 83 → median ~82 credits/chunk
- **Projected daily completion**: at 25 sets/cycle × 20 min/cycle, remaining 333 sets finish ~04:40 UTC tomorrow. Fits inside the registered `*/20 11-23` fire window (last fire 23:40 UTC → wraps overnight).
- **Open alerts**: none
- **Credit floor hits**: none (plenty of headroom at ~82 cr/run × 39 slots = ~3,200 cr/day, well under the 150k/mo cap)

The 16:00:25 UTC run that failed with "TCGGRAPH_API_KEY not set" IS visible in the Vercel logs but is NOT in `pokemon_tcg_ingestion_runs` because the chunk route exits before writing the run row when the auth gate fails. All subsequent runs are clean.

## 5 · Public migration state (unchanged)

| Guard | Verified at memo time |
|---|---|
| `www.pokeprices.io/` returns 200 · no `tcggraph.io` references | ✓ |
| sitemap.xml / robots.txt | ✓ 200, unchanged |
| Python scraper (card_trends.as_of latest) | **2026-10-18** — writing today |
| TCGGraph credits spent in this ticket | 0 |
| `PP_USE_TCGGRAPH_*` production env flags | all **unset** |
| Public card URLs, canonicals, SEO | unchanged |

## 6 · Remaining genuine blockers before public cut-over

| Blocker | Severity | Owner | Notes |
|---|---|---|---|
| **Identity approval not executed** | 🟡 | operator sign-off | 37,175 ready via `--apply`; 0 TCGGraph credits spent on execute |
| **Licensing agreement unsent** | 🔴 | operator (legal) | `LICENSING_DRAFT.md` still unsent to TCGGraph |
| **Image rights not confirmed** | 🔴 | operator (legal) | hotlink + commercial display for `cards.tcggraph.io` |
| **Historical rights decision** | 🔴 | operator (legal) | Option A (keep legacy history) vs Option B (TCGGraph-only) |
| **345 top-traffic quarantined** | 🟡 | matcher extension ticket | ~41% of top-GSC cards still quarantined — matcher work, not QA/pricing-safety |
| **29 top-traffic unmapped** | 🟡 | dedicated matcher pass | PP cards with no mapping row |
| **Public selector widget** (USD/EUR) | 🟢 | 10-LOC follow-up | infra ready in admin preview only |

## Final deliverables summary

| # | Deliverable | Status |
|---|---|---|
| 1 | Correction-run reconciliation (30,314 vs 19,911) | **✓ Documented** — see §1 above |
| 2 | Exact identity-approval dry-run count | **✓ 37,175** (0 dup, 0 non-approvable) |
| 3 | Approval script ready for explicit sign-off | **✓ Ready** — `scripts/pp-tcg-match-qa-11-approve-identities.mjs --apply` |
| 4 | High-traffic mapping recovery results | **✓ Diagnosed, 0 safely auto-resolvable** — see §3 for action items |
| 5 | Revised coverage of the 831 important card URLs | **✓ Unchanged** at 430 approvable / 345 quarantined / 29 unmapped |
| 6 | Observed automatic ingestion status | **✓ Running** — 51.2% through today's cycle, 10 successful runs post-fix |
| 7 | Remaining genuine blockers before public cut-over | **✓ Listed** — 3 legal, 2 matcher, 1 UI |

**Awaiting explicit sign-off before executing `scripts/pp-tcg-match-qa-11-approve-identities.mjs --apply`.** Nothing public changes on approval alone.
