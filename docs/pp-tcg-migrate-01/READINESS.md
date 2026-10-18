# PP-TCG Migration — Readiness Checklist

Status snapshot after PP-TCG-MIGRATE-03A. Public PokePrices site is still PriceCharting-powered. The TCGGraph provider path is private-preview-only and fully gated.

Legend: ✅ Done · 🟡 Partial · 🔴 Blocked

## 1. Daily full-catalogue ingestion + API credit budgeting

- 🟡 Daily discovery cron registered (`0 10 15 * * *`) at ~9 cr/day
- 🟡 Daily health cron registered at ~1 cr/day
- 🔴 **Full catalogue ingestion (1,138 cr × 570 req) is NOT scheduled** — ran manually. Vercel 300s function timeout is the blocker. Options when operator decides:
  - Chunk the scan by set-code cursor (processes ~50 sets per 15-min run, full coverage over a day)
  - Switch hub to Pro-tier for 800s runs
  - Move ingestion to a long-running worker outside Vercel

**Monthly projection with current state**: ~300 cr (crons) + 1,138 cr × N on-demand full scans. Operator-controlled; well inside 150k/mo allowance (~130k remaining).

## 2. Private historical-series completeness

- 🟡 **28 sample cards** have ingested daily history (877 points) covering vintage/modern/JA/1st-ed/shadowless/reverse-holo/high-traffic
- 🔴 Full-catalogue history (46,777 verified identities × 3 cr/call = ~140k credits) is NOT budgeted — exceeds a single month's allowance
- Reasonable approach: ingest history only for `bulk_safe` + GSC top-N cards (~23k × 3 = 70k cr spread over 7-10 days)

## 3. Licensed card imagery

- 🟡 55,312 TCGGraph provider images ingested (91.1% of mapped cards)
- 🟡 Resolver bundled at `pokeprices-web/src/lib/providerData/snapshot.ts` with `canReturnImages` gate
- 🔴 **Image rights not confirmed**. See `LICENSING_DRAFT.md` §6. Two blockers before Stage 5 of CUTOVER:
  - Hotlink rights (`cards.tcggraph.io/...`)
  - Re-host rights (proxy via Vercel image optimisation)
- `PP_USE_TCGGRAPH_IMAGES` env flag will stay unset until written confirmation received

## 4. Public promo-set separation with SEO-safe URLs

- 🔴 Deferred to next stage per operator instruction
- Current state: PP's broad "Promo" sets collapse ~2,500 cards into a single URL namespace; TCGGraph has 60+ specific promo-set codes (xyp, svp, basep, bkp, kwbp, wcd2004–2016, ...). Promo-distribution-routing already maps PP cards into these codes internally — any public URL re-partitioning is a separate SEO project
- The matching + preview already shows the right TCG promo set code per card. The URL doesn't need to change for the migration to work; it will need to change if we want the SEO benefit of discoverable per-promo-set browsing

## 5. Sitewide USD/EUR selector with cached exchange rates

- 🔴 Deferred to next stage per operator instruction
- Design hint: TCGplayer returns USD, Cardmarket returns EUR. The preview currently renders both at their native currencies with explicit `$`/`€` prefixes. A sitewide selector would need: a daily FX fetch job, a user preference, and a conversion helper. None of these exist today

## 6. Commercial licensing approval

- 🔴 **8 clarification questions drafted at `LICENSING_DRAFT.md`; NOT sent**. Operator approval required before sending.
- Must receive written answers before Stage 3 of CUTOVER (public prices flip)
- Separate questions in §3 of the draft specifically probe graded-dataset provenance — the 0% divergence between PriceCharting-era data and TCGGraph graded values is strong evidence of a shared upstream dataset. Not an allegation; a question that needs an answer

## 7. Safe public activation + scraper retirement

Current gating state (every box must be checked, in order):

- 🟡 **a. Approved mappings** — 46,777 identity-verified; **0 operator-approved** (bulk approve pending in `/admin/pokemon-matching`)
- 🟡 **b. Provider price ingestion** — 202,833 market + 165,846 graded rows, from a single October 18 scan
- 🔴 **c. Field-level eligibility validated by operator** — needs the preview review this ticket enables
- 🔴 **d. Public activation authorised** (requires 1 + 3 + 6 + 7)
- 🔴 **e. Legacy scraper retirement** — Python repo at `C:/Users/lukep/OneDrive/Desktop/pokeprices/` with GitHub Actions cron `0 8 * * *`. Decommission plan in CUTOVER §3 Stage 7: keep running for 30 days post-flip, then archive

### Current `card_trends` state

Latest nightly rebuild: 2026-10-17 (observed on sample cards). Scraper is healthy. **Do not stop it** until a flip-and-dwell window has proven the TCGGraph path on production.

## 8. What the operator can safely do RIGHT NOW

- Open `/admin/tcg-preview` (requires login + email in `ADMIN_ALLOWED_EMAILS`)
- Click any sample's "Full-template preview →"
- Compare against the "Current public page ↗" link in the banner
- Approve mappings in `/admin/pokemon-matching` once satisfied with sample previews
- Send `LICENSING_DRAFT.md` to TCGGraph commercial

Everything else is gated.

## 9. What the operator should NOT do until each box is checked

- Flip `PP_USE_TCGGRAPH_PRICES=1` in Vercel production
- Flip `PP_USE_TCGGRAPH_IMAGES=1`
- Flip `PP_USE_TCGGRAPH_HISTORY=1`
- Disable the Python scraper's GitHub Actions schedule
- Deprecate `card_trends` table
