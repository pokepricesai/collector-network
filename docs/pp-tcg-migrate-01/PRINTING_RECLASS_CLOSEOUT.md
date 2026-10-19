# PP-TCG-PRINTING-RECLASS-CLOSEOUT — final pass

Public TCGGraph flags **OFF**. 18 pilot switches **OFF**. 0 deleted rows. 0 auto-remaps. 0 public page/SEO/URL/scraper changes.

## Closeout tally

| | |
|---|--:|
| provider_cards rows marked `superseded` this ticket | **9** (across 7 more pairs) |
| **Total superseded cumulative** (previous 26 + today 9) | **35** |
| TCGGraph credits spent this ticket | **40** (budget cap) |
| TCGGraph credits spent across the workstream | 76 + 40 = **116** total |
| Approved mappings pointing at a superseded (card_id, printing) | **3** (unchanged — same 3 cards; just 2 of them already identified in previous pass, 1 confirmed) |
| Pilot cards affected | **0** |

## §1 · Remaining orphan run (37 → finished what budget allowed)

Executed `pp-tcg-reclass-fix-01-detect-mark.mjs --apply --budget 40`. Probed 7 of the 26 remaining pairs. **9 orphans marked superseded. 0 removed-from-API.** Budget cap hit (40/40 cr).

**19 pairs with ~28 orphan rows remain unprobed.** Not blocking: the integrated chunk-cron detection (§2) will handle them automatically on the next normal cycle at zero extra API cost.

## §2 · Integrated into chunk cron — no extra API calls

`apps/hub/src/app/api/cron/pp-tcg-ingest-chunk/route.ts` now runs the reclassification sweep on every chunk fire, using the response data already fetched by `listCardsInSet`. Zero additional API requests.

Key design points:

- `listCardsInSet` now returns `{ cards, complete }` where `complete=true` only when pagination terminated via `hasMore=false`. Hitting the page-20 safety cap leaves `complete=false`.
- Only sets with `complete=true` are added to the per-cycle `reclassWorkPerSet` list.
- After the chunk's bulk upserts succeed, for each entry in that list the route:
  1. Builds `card_id → Set<printing_key>` from the completed API response
  2. Pulls `provider_status='active'` rows for the same `(set, lang)`
  3. For each stored row: if `card_id` is in the response but `printing_key` is NOT → mark `superseded` with reason `"chunk cron: tcggraph reclassified printing_key for <set>|<lang>"`
  4. Rows for `card_ids` ABSENT from the response are LEFT active — same safe-fail rule as the one-off script

### Invariants satisfied (§3)

| Scenario | Behaviour |
|---|---|
| Normal multi-printing card (e.g. card has `[normal, foil, reverse-holo]` in API) | All three stay active. No row marked. |
| Reclassification (`[normal]` → `[foil]` for same card_id) | OLD `(card_id, normal)` marked superseded, pointing at the new `foil` key via `superseded_by_printing_key`. |
| Failed pagination (page-20 cap or HTTP error) | `complete=false` → set is NOT in `reclassWorkPerSet` → nothing marked for that set this cycle. |
| Card temporarily absent from API | `card_id` not in `apiPrintings` map → stored row LEFT active. Operator reviews separately. |
| Historical prices | **Never touched.** `prices_market`, `prices_graded`, `prices_history` reads/writes untouched by the sweep. |

The chunk response JSON and `pokemon_tcg_ingestion_runs.metadata` now include `reclass_marked_superseded` (count) and `reclass_sets_scanned` (count) for observability. 46 hub tests pass, hub typecheck clean.

## §4 · Three affected mappings — verified

### Darkrai EX #72 (`pp_card_slug=3461618`) — remap QA report

Candidate: `pkm_ja_ebb_72 | foil`:

| Check | Result |
|---|---|
| Active provider_card row exists for candidate | ✓ |
| Market feed row for candidate | ✓ 1 row |
| Siblings (active printings for same card_id) | just `[foil]` — single printing |
| Other PP mappings claiming same (card_id, foil) | **0** — no conflict |
| PP #72 ↔ TCG collector_number 72 | **match** |
| TCGplayer / Cardmarket external IDs | none (JA promo set; typical) |
| Projected post-remap eligibility | `bulk_safe` (single printing) → upgraded from current `market_only` |
| Projected post-remap QA class | `internally_consistent` (no external marketplace ref) |

**Verdict**: Remap would be internally safe. However, since it would UPGRADE eligibility from `market_only` to `bulk_safe` (which activates graded pricing exposure), and the QA class moves from `catalogue_corroborated`-equivalent to `internally_consistent` (lower confidence), **operator sign-off required**. Not applied.

### Drowzee [1st Edition] #40 (`pp_card_slug=10366699`) and Darkrai EX [1st Edition] #72 (`pp_card_slug=10801470`)

Both PP cards have `[1st Edition]` variant tags. TCGGraph has removed the `1st-edition` printing from both card_ids and now returns only `normal` / `foil` respectively. **No safe remap target** — the PP identity requires a 1st-edition classification that TCGGraph no longer provides.

Confirmed invariants:
- Current `pricing_eligibility='market_only'` — unchanged
- Public TCGGraph flags OFF — zero display impact today
- **Now also protected by CLOSEOUT §4 fix**: `snapshot.ts` suppresses market + graded prices when the provider_card row for the mapping's `(card_id, printing_key)` is not active. So EVEN IF public flags flipped on, these mappings would serve nothing (fail-closed) rather than incompatible prices from the stale 1st-edition key.

## §5 · Verified zero inappropriate selection

### snapshot.ts hardening (new in this ticket)

Added `providerCardActive = !!cardRes.data` check. All three return gates (`canReturnMarket`, `canReturnGraded`, `canReturnImages`) are now AND'd against `providerCardActive`. If the provider_cards row for the mapping's exact `(card_id, printing_key)` is not active (either superseded or missing), the adapter suppresses market, graded, AND images — regardless of eligibility, pilot, or env flag state. **70 providerData tests pass** (69 → 70, +1 "incompatible prices suppressed" test).

### Remaining exceptions

| Count | Category | Impact |
|---|---|---|
| 3 approved mappings | Point at superseded printings. Adapter fails closed. | 0 public (flags off, pilot off). 1 operator remap candidate (Darkrai EX #72) + 2 unresolvable identity mismatches (both `[1st Edition]`). |
| ~28 orphan rows across 19 pairs | Not yet probed/marked (budget cap). | 0 public. Chunk cron will mark them automatically on each (set, lang)'s next successful completion. |

## §6 · Guard rails verified

| | |
|---|---|
| Public TCGGraph flags | **OFF** (all four) |
| 18 pilot switches | **OFF** (every row) |
| Indexed card URLs / canonicals / SEO / sitemap / robots | unchanged |
| Python PriceCharting scraper | running |
| Deleted provider rows | **0** |
| Historical prices (prices_market/graded/history) | preserved |
| Auto-remapped approved mappings | **0** |
| Hub typecheck | ✓ clean |
| PP-web typecheck | ✓ clean |
| Hub tests | 46 pass |
| PP-web providerData tests | **70 pass** |

## Workstream closeout

With the chunk cron now carrying the reclassification detection, the ingestion and reclassification workstreams are **closed** pending:

1. **Tomorrow's 2026-10-20 full six-check verification** (JA ingest fix separate ticket)
2. **Operator decision** on the 3 affected approved mappings (one remap candidate, two unresolvable)

No further broad audits. The next chunk cycle will handle the remaining ~28 orphans automatically with zero extra API spend.
