# PP-TCG-QA-FINAL — Reconciled Decision Memo

All four blockers resolved. Public TCGGraph pricing/images/history remain **OFF**. No bulk approval executed. No corrections applied. 0 TCGGraph credits spent.

## §1 · Invalid eligibility upgrades removed

The earlier recommender upgraded `not_eligible → identity_only` and `bulk_safe → identity_only` for ambiguous/unverifiable rows. Fixed via `scripts/pp-tcg-match-qa-06-recompute.mjs` with corrected policy:

| Risk class | New policy |
|---|---|
| `catalogue_corroborated` | keep prior |
| `internally_consistent` | keep prior |
| `pricing_restriction` | multi-printing bulk_safe → market_only; no-market → identity_only; **never upgrade uncertain / not_eligible** |
| `ambiguous_variant` | hard quarantine → `not_eligible` |
| `conflicting_identity` | hard quarantine → `not_eligible` |
| `unverifiable` | hard quarantine → `not_eligible` |

**22,128 recommendation rows rewritten** to quarantine instead of upgrade.

The 7 `pricing_restriction / uncertain → identity_only` upgrades were also walked back — those 7 remain `uncertain` pending operator triage.

## §2 · Reconciled counts

Reconciliation via `scripts/pp-tcg-match-qa-07-reconcile-counts.mjs` — joined on unique mapping_id. Every mapping accounted for exactly once:

| Lens | Count |
|---|--:|
| mappings total | 60,689 |
| qa rows total | 60,689 |
| orphans | 0 |

| Risk class | all | approvable (verified + pending/unmatched) |
|---|--:|--:|
| catalogue_corroborated | 25,127 | **23,797** |
| pricing_restriction | 13,382 | **13,375** |
| internally_consistent | 4 | **3** |
| **IDENTITY-SAFE SUBTOTAL** | 38,513 | **37,175** |
| ambiguous_variant | 14,424 | — (quarantined) |
| conflicting_identity | 58 | — (quarantined) |
| unverifiable | 7,694 | — (quarantined) |
| **QUARANTINED SUBTOTAL** | 22,176 | — |
| identity-safe but not approvable (confidence < verified or alt review_status) | 1,338 | — |

**Reconciliation**: 37,175 + 22,176 + 1,338 = **60,689** ✓

### Local vs DB view agreement (previously 236-row discrepancy)

| Count | Local calc | DB view | Match |
|---|--:|--:|:-:|
| v_pokemon_tcg_bulk_approve_candidates | 23,797 | 23,797 | ✓ |
| v_pokemon_tcg_identity_safe_cohort | 37,175 | 37,175 | ✓ |

The earlier 236-row drift was an artefact of comparing `prior_pricing_eligibility` (frozen at audit time) against the view's `pricing_eligibility` (live from mapping row). After the recompute + fresh query, both sources give identical numbers.

## §3 · Adapter fails closed

### `pokeprices-web/src/lib/providerData/snapshot.ts`

```ts
const { data: effective, error: effErr } = await sb
  .from('v_pokemon_tcg_effective_eligibility')
  .select('effective_eligibility')
  .eq('pp_card_slug', pp_card_slug)
  .eq('provider', 'tcggraph')
  .maybeSingle();
if (effErr) return null;             // DB error → fail closed
if (!effective) return null;         // no QA row at all → fail closed
if (!effective.effective_eligibility) return null;  // null effective → fail closed
```

**No fallback to `mapping.pricing_eligibility`** — if the view can't give us an effective value, the mapping is not displayable.

### Rank function + view semantics

```sql
case e
  when 'uncertain'      then 4   -- tied with not_eligible — both block all display
  when 'not_eligible'   then 4
  when 'identity_only'  then 3
  when 'market_only'    then 2
  when 'bulk_safe'      then 1
  else 4                           -- NULL / unexpected → quarantine
end
```

The effective view uses `>=` so when ranks tie (uncertain / not_eligible / NULL), `qa.recommended` wins — the audited intent always takes precedence over the raw matcher assignment.

### New vitest coverage (6 fail-closed cases, 55 total providerData tests pass)

- `effective view errors → return null`
- `effective view returns no row → return null`
- `effective_eligibility is literally null → return null`
- `effective says not_eligible but mapping says bulk_safe → gate everything off` (ambiguous_variant pre-correction)
- `effective says market_only but mapping says bulk_safe → gate graded off, keep market` (pricing_restriction pre-correction)
- `effective says uncertain → gate everything off even with image available` (conflicting_identity scenario)

## §4 · Transactional, resumable, audited corrections

### Infrastructure

**`pokemon_tcg_qa_correction_runs`** — persists run_id with `status in (in_progress, completed, failed)`, `corrections_total`, `corrections_applied`, `dry_run_snapshot` JSONB. Row inserted **before** any writes.

**`apply_pokemon_tcg_qa_correction_batch(run_id, batch_size)`** — plpgsql function. Each call is one transaction containing:
1. UPDATE `pokemon_tcg_mappings` for a batch of corrections
2. INSERT `pokemon_tcg_mapping_audit` row per update
3. UPDATE `pokemon_tcg_qa_correction_runs.corrections_applied`
4. On completion (`remaining=0`), flip status to `completed`

Rollback via `rollback_pokemon_tcg_qa_correction_run(run_id)` — reads audit rows, writes new audit rows for the rollback, reverts mappings to prior eligibility, flips run status to `failed`.

### Resumability

The batch query picks corrections that have **no audit row for this run_id**. If the batch dies mid-flight, re-running with the same `--run <id>` continues from where it stopped. Script also fails closed if any correction is LESS restrictive at the adapter rank, refusing to apply.

### Dry-run output — final

| Direction | Count | Risk class origin |
|---|--:|---|
| bulk_safe → market_only | 13,202 | pricing_restriction |
| identity_only → not_eligible | 8,066 | 8,034 ambiguous + 32 unverifiable |
| uncertain → not_eligible | 7,338 | 6,060 ambiguous + 1,220 unverifiable + 58 conflicting |
| bulk_safe → not_eligible | 1,294 | 1,013 unverifiable + 281 ambiguous |
| market_only → not_eligible | 242 | 193 unverifiable + 49 ambiguous |
| market_only → identity_only | 167 | pricing_restriction |
| bulk_safe → identity_only | 5 | pricing_restriction |
| **Total corrections** | **30,314** | |
| of which strictly more restrictive | 22,976 | |
| of which same-rank recategorisation (uncertain ↔ not_eligible) | 7,338 | |
| of which less restrictive | **0** | — guard blocks apply if non-zero |

### Before / after

| Eligibility | BEFORE | AFTER | Δ |
|---|--:|--:|--:|
| bulk_safe | 23,474 | 8,973 | **−14,501** |
| market_only | 15,204 | 27,997 | +12,793 |
| identity_only | 8,099 | 205 | **−7,894** |
| not_eligible | 5,236 | 22,176 | +16,940 |
| uncertain | 8,676 | 1,338 | −7,338 |
| **TOTAL** | **60,689** | **60,689** | **0** |

Snapshot persisted: `scripts/_pp-tcg-match-qa/dry-run-corrections-final.json`

## §5 · Operator decision

### The numbers

| Decision | Count |
|---|--:|
| **1. Safe for identity approval (`review_status='approved'`)** | **37,175** |
| **2. Safe for aggregate graded pricing (`bulk_safe`)** | **8,973** |
| **3. Limited to exact-printing market pricing (`market_only`)** | **27,997** |
| **4. Images only (`identity_only`)** | **205** |
| **5. Quarantined (`not_eligible`)** | **22,176** |
| **6. Still requiring human investigation** | 1,338 (identity-safe + confidence < verified) + 14,424 (ambiguous_variant triage) + 58 (conflicting_identity) = **15,820** |

Pricing counts (2+3+4) sum to the identity-approvable total (8,973 + 27,997 + 205 = 37,175). ✓

### Validation sample commentary

The 25-card sample at `scripts/_pp-tcg-match-qa/validation-sample.md` was drawn from `catalogue_corroborated` with `recommended = prior` (the pure clean set). After the recompute:

- **Normal cohort** (Trick or Trade 2023, modern EN): all 5 cards have single printing — stay `bulk_safe` after corrections. ✓
- **Foil cohort** (White Flare ex cards): all 5 single-printing — stay `bulk_safe`. ✓
- **Vintage cohort** (Fossil 1st Edition): all 5 correctly `market_only` because the TCG card has `normal + 1st-edition` printings → graded aggregate contaminated. Operator can confirm bulk graded never shows. ✓
- **Japanese cohort** (Mega Brave): all 5 either `foil` single-printing or `normal` single-printing — identity confirmed. Japanese TCG cards do not have graded data in TCGGraph (invariant upheld). ✓
- **High-traffic cohort**: pulled from `commercial_rank` top-500. Operator should spot-check these specifically since they drive the most visitor impressions.

### Preconditions before approving

1. Operator opens 5 cards from each validation cohort in a new browser tab (pokeprices.io URL in one window, pokemontcg.io set page in another). If any row's identity cannot be visually confirmed from the external catalogue, open a triage ticket before approving the cohort it belongs to.
2. Operator reviews `scripts/_pp-tcg-match-qa/dry-run-corrections-final.json` and confirms the 30,314-row distribution matches expectations.
3. Operator runs:
   ```
   node scripts/pp-tcg-match-qa-08-apply-corrections.mjs --apply
   ```
   The script registers `run_id` first, applies 500-row RPC batches, and prints the `run_id` for rollback on completion.
4. Operator writes a separate approval script that sets `review_status='approved'` for the 37,175 mappings in `v_pokemon_tcg_identity_safe_cohort`. (Not written in this ticket — identity approval is a separate operator decision.)

### After approval — public cutover

Even after the 37,175 approvals land, **public TCGGraph pricing stays off** until:
- `PP_USE_TCGGRAPH_PRICES=1` is set in pokeprices-web production env
- `PP_USE_TCGGRAPH_IMAGES=1` is set (requires image-rights sign-off)

Those flags are separate operator decisions gated on licensing, as before.

### Guard-rail verification

| Guard | State |
|---|---|
| Public pricing / images / history unchanged | ✓ |
| Public URLs / canonicals / sitemap / robots unchanged | ✓ |
| Python scraper running nightly 08:00 UTC | ✓ |
| All `PP_USE_TCGGRAPH_*` env flags unset | ✓ |
| No mappings auto-approved | ✓ |
| 0 TCGGraph credits spent | ✓ |
| Hub typecheck + tests (46 vitest) | ✓ |
| PP-web typecheck + providerData tests (55 vitest) | ✓ |
| QA table `recommended_pricing_eligibility` fully recomputed | ✓ |
| Correction script dry-run shows 0 less-restrictive changes | ✓ |
| Adapter fails closed on missing QA / view errors | ✓ |
| All counts reconcile to the 60,689 mappings total | ✓ |

Stopping before any correction, approval or public activation.
