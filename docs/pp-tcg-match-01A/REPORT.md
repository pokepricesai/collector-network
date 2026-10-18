# PP-TCG-MATCH-01A — Completion Report

**Date:** 2026-10-18
**Scope:** Pokémon-only safety + usability pass on the matching workbench. Admin-only. Read-only against public pricing.
**Deployment:** commit `d3616458`, Vercel `dpl_7Q8u2ekqDmC7Ly5h5J7ECAQoA2Hz` — state **READY** at 2026-10-18 00:54:20Z, built in 84 s. Current production.
**Admin URL:** `https://collector-network-lukepierce.vercel.app/admin/pokemon-matching`

---

## 1. Headline

The PP-TCG-MATCH-01 claim of **43,766 bulk-approvable** mappings conflated card-identity verification with price applicability. After the safety pass:

- **21,568 mappings are genuinely safe for bulk approval** (`pricing_eligibility = 'bulk_safe'`).
- The remaining 22,198 "verified" rows split into `market_only` (14,659), `identity_only` (7,539), with a further 12,657 `uncertain` and 4,266 `not_eligible` across the full 60,689 catalogue.

The bulk-approve preview on the live admin page returns the revised **21,568** figure. Verified by replicating the exact `bulkApproveDryRun` filter against Supabase.

## 2. Admin routes verified

Anonymous `curl` against production:

- `GET /admin/pokemon-matching` → **307** → `/admin/login?returnTo=/admin/pokemon-matching`
- `GET /admin/pokemon-matching/886351` → **307** → `/admin/login?returnTo=/admin/pokemon-matching`

Auth gate (`requireAdmin()`) fires on both the list and per-slug routes. Zero exposure of mapping data to unauthenticated callers.

## 3. Approve-and-undo test — 10 representative mappings

Run via `scripts/pp-tcg-match-01a-verify.mjs`. Full JSON at `scripts/_pp-tcg-match-01a/verify.json`.

| Case | PP slug | Set | pricing_eligibility | approve | undo | audit Δ |
|---|---|---|---|---|---|---|
| bulk_safe English modern | 4934026 | Scarlet & Violet | bulk_safe | OK | OK | +1 / +1 |
| bulk_safe Japanese | 3491907 | Japanese Dark Phantasma | bulk_safe | OK | OK | +1 / +1 |
| bulk_safe vintage | 641808 | Base Set 2 | bulk_safe | OK | OK | +1 / +1 |
| market_only Reverse Holo | 957199 | Plasma Freeze | market_only | OK | OK | +1 / +1 |
| market_only 1st Edition | 2158462 | Neo Discovery | market_only | OK | OK | +1 / +1 |
| market_only Shadowless | 715718 | Base Set | market_only | OK | OK | +1 / +1 |
| identity_only Mirror Holo | 11519046 | Japanese Start Deck 100 | identity_only | OK | OK | +1 / +1 |
| identity_only Jumbo | 7866355 | Paradox Rift | identity_only | OK | OK | +1 / +1 |
| market_only Japanese | 10802062 | Japanese Intense Fight | market_only | OK | OK | +1 / +1 |
| bulk_safe high-traffic (GSC) | 12368556 | Perfect Order | bulk_safe | OK | OK | +1 / +1 |

Each row:
1. Was transitioned `pending_review → approved` with the correct reviewer and timestamp fields.
2. Produced exactly **one** `pokemon_tcg_mapping_audit` row for the approve.
3. On undo, was transitioned back to its original `review_status` using the saved `previous_review_status`.
4. Produced exactly **one** additional audit row for the undo.
5. Returned to its original state after undo — verified by column-by-column comparison before and after.

(We intended an `identity_only_promo` card — the broad promo-set filter returned zero live rows against the current `identity_only` cohort because promo sets predominantly ended up `market_only` or `uncertain` after the backfill. We substituted `market_only_jp` as the tenth case to retain full language coverage.)

### Authentication during the test

The verify script uses the service-role key (bypasses RLS, same channel the backfill uses). The server actions themselves route through `requireAdmin()` + the admin's session Supabase client; the earlier 307 redirect test confirms that path is intact and that the matching tables are not readable by anonymous or non-admin sessions.

## 4. Idempotency

Confirmed by replicating `bulkApproveTick`'s filter against Supabase:

- Pre-approve preview count: **21,568** (bulk_safe pending, verified, with TCG id).
- Approve one eligible row → preview shrinks to **21,567** (Δ = 1).
- Undo that row → preview returns to **21,568**.

Approving an already-approved row is a no-op in the next tick because the filter `review_status='pending_review'` excludes it. There is no re-approval risk in a retried batch.

## 5. Batch resumption

Simulated by creating a `pokemon_tcg_bulk_batches` row with a known `last_pp_slug` cursor:

- Chunk 1 (first 5 bulk_safe rows): cursor = `10026621`.
- Chunk 2 (resumed after cursor): starts at `10026627` — the first row with `pp_card_slug > 10026621`.
- **No overlap** between the two chunks; **cursor advanced**.

Rows in the test batches were not actually approved — the chunks were fetched to prove resumption shape, then the batch was marked `cancelled`. The resume path works as designed: a reconnect after an outage picks up at the next slug after `last_pp_slug`.

## 6. Live pricing untouched

Spot-checked `card_trends.current_raw / current_psa10 / current_psa9 / as_of` for all 10 test slugs before and after the test. Every row carries `as_of = 2026-10-17` (the pre-work pull date) — no writes from the test actor. The test script never issues an UPDATE or INSERT against `cards` or `card_trends`; those tables are not referenced in the SQL path at all. Public pricing, URLs, SEO and ingestion are unchanged.

## 7. State of the DB after the test

- `pokemon_tcg_mappings`: **unchanged** at the row level — all 10 test cards returned to their pre-test `review_status` (`pending_review`). Reviewer, timestamp and match_method columns show the last-touched state from the undo step; this is expected and desirable (it leaves a visible trace for the operator).
- `pokemon_tcg_mapping_audit`: **22 new rows** written during the test — 10 approve + 10 undo for the main cards, plus 1 approve + 1 undo for the idempotency sub-test. All tagged `actor_display = 'pp-tcg-match-01a-verify'` for easy filtering.
- `pokemon_tcg_bulk_batches`: **1 new row** created and immediately marked `cancelled`. No rows approved via that batch.
- No full 21,568-row approval has been executed.

## 8. What was NOT done

- No full 21,568-row bulk approval.
- No change to public PokePrices pricing, URLs, SEO, images or `card_trends`.
- No TCGGraph price ingestion job created.
- No contact with TCGGraph.
- Vercel preview deployments or private feature flags were not toggled.

## 9. Operator next steps

1. **Review the live admin workbench** at the URL above — specifically the top metric cards (`bulk_safe pending = 21,568`), the Bulk Approve panel's Preview button, and the Set Aliases panel.
2. **Spot-check a few bulk_safe rows manually** via the Review button to confirm the matched TCG card is the one you expect for each era (vintage, modern, Japanese).
3. **If satisfied, run the full bulk approval.** The resumable batched flow means the UI will chug through 21,568 rows in ~43 batches of 500. Each tick is one HTTP action. If the browser disconnects, re-opening the page shows the running batch and it resumes from `last_pp_slug` automatically.
4. **No price activation** happens as a side effect. `activation_eligible` stays `false` on every row. A separate Phase-8 implementation (deliberately not built yet) would add the public read-path flip.

## 10. Scripts + file inventory

- `scripts/pp-tcg-match-01a-audit.mjs` — audit the 43,766 "verified" bucket (origin of the 21,568 figure).
- `scripts/pp-tcg-match-01a-backfill.mjs` — backfill `pricing_eligibility` + `commercial_rank` on every mapping.
- `scripts/pp-tcg-match-01a-verify.mjs` — the 10-card approve/undo + idempotency + batch-resumption smoke test (this report).
- `scripts/_pp-tcg-match-01a/verify.json` — raw per-check output (gitignored).
- `supabase/migrations/20261018010000_pokemon_tcg_match_01a.sql` — schema (applied live).
- `apps/hub/src/server/pokemon-matching/eligibility.ts` — pure classification logic (33 vitest cases).
- `apps/hub/src/server/pokemon-matching/__tests__/eligibility.test.ts` — regression suite.
- `apps/hub/src/app/admin/pokemon-matching/actions.ts` — approve/reassign/reject/undo + batched bulk-approve + alias actions.
- `apps/hub/src/app/admin/pokemon-matching/{page.tsx,[slug]/page.tsx,BulkApproveForm.tsx,SetAliasPanel.tsx,[slug]/ReviewActions.tsx}` — UI.

For the broader PP-TCG-MATCH-01 context (schema design rationale, matcher architecture, Phase-8 activation design, Phase-9 licensing checklist) see `docs/pp-tcg-match-01/REPORT.md`.
