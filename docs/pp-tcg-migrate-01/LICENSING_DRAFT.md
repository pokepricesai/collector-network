# PP-TCG-MIGRATE-01 — Licensing Clarification Draft

**Status:** DRAFT. Operator approval required before sending.
**Target recipient:** TCGGraph commercial team (contact details TBD by operator — likely a `commercial@` or `legal@` address, or the sales contact who originally sold us the Growth plan).

---

Hi,

We run Collector Network — five Pokémon / Magic / Yu-Gi-Oh! / One Piece / Lorcana TCG pricing sites — on your Growth plan. We're preparing to switch our Pokémon pricing site (pokeprices.io) to source its public pricing from TCGGraph as the sole provider, replacing a legacy data pipeline. Before we go live, we need to confirm a few points on commercial display rights, dataset provenance and attribution.

## 1. Public commercial display

Our subscription grants API access. Does that subscription also permit us to publicly display the retrieved values on commercial Pokémon pricing pages? Specifically:

- Current market / cardmarket / cardkingdom / manapool quotes
- Raw ungraded valuations
- Pooled grade 7 / 8 / 9 / 9.5 values
- PSA 10, BGS 10, CGC 10, SGC 10 valuations
- Daily historical series retrieved via `/v1/prices/{id}/history`
- Realised-sales averages retrieved via `/v1/prices/{id}/sales`

If so, is there a format or attribution requirement we must meet (visible "powered by TCGGraph" badge, link, specific wording)?

## 2. Five-site Growth plan scope

We hold one $59/month Growth subscription. Does that single subscription cover all five Collector Network websites displaying TCGGraph data to end users:

- `pokeprices.io`
- `mtgprices.io`
- `ygoprices.io`
- `onepieceprices.io`
- `lorcanaprices.io`

…or does each site require its own commercial agreement?

## 3. Graded dataset provenance

Our verification work found that your `gradedPrices` responses are **exactly identical** (0.0% divergence) to the realised-sales valuations our legacy pipeline currently publishes, on correctly-matched same-printing card samples spanning vintage and modern. This is a strong signal of a shared upstream dataset.

- What is the source of your raw ungraded / PSA 10 / pooled-grade valuations? Is it an eBay realised-sales aggregation you perform in-house, or do you license from a third-party index (PriceCharting, PWCC, GemRate, Market Movers, etc.)?
- If you license from a third party, do our commercial display rights extend transitively via your subscription, or do we need a separate relationship with the upstream provider?

We're not alleging anything — we're asking so we can establish a defensible licensing chain before cut-over.

## 4. Pooled-grade attribution

TCGGraph exposes `grader: 'any', grade: '9'` for pooled grades below 10. We plan to label these as **"Grade 9 (pooled across graders)"** or similar — never as "PSA 9". Please confirm:

- Is "Grade 9 (pooled)" acceptable attribution wording?
- Do you require a tooltip or footnote explaining that it averages PSA / BGS / CGC / SGC at that grade?

## 5. Historical storage and retention

Can we store the full `/v1/prices/{id}/history` daily points indefinitely in our own database to drive chart rendering?

- If TTL / re-fetch is required: what cadence?
- If indefinite storage is permitted: is there a notification requirement if a card is removed from your catalogue?

## 6. Card artwork rights

You serve card imagery at `cards.tcggraph.io/...`. Our site currently uses a legacy image URL from a different provider. We would prefer to display your images:

- Does the Growth plan include the right to hotlink (serve direct from `cards.tcggraph.io`)?
- Does it also include the right to re-host (proxy via our own CDN) for performance?
- Any commercial-use restrictions on specific image classes (e.g. Japanese scans sourced from The Pokémon Company)?

## 7. Attribution placement

If visible attribution is required, where must it appear?

- On every card page?
- In a footer only?
- Per-field badge next to the price?
- API Terms acceptance confirmation URL for our records?

## 8. Future game SKUs

If TCGGraph adds a new TCG, does it automatically fall under our Growth subscription, or does it require a plan addendum?

---

**What we are NOT asking you to confirm:**
- That any specific upstream data provider has or has not licensed data to you.
- That we have the right to retain or publish our existing legacy historical records — we understand that is a separate licence question with the legacy provider, not with you.

Thanks for the clarity — once we have your confirmation we can finalise the public cut-over timing.

---

### Internal notes (do NOT send to TCGGraph)

- Luke to review draft before sending.
- Preferred to send once we have a specific contact (ask the TCGGraph sales rep for the right recipient first).
- Expected response window: ~1 week.
- If the response identifies an upstream licence we don't hold, cut-over must pause pending the operator deciding whether to engage that provider directly.
- The "0.0% divergence" finding is from PP-TCG-MATCH-01B §5 (`docs/pp-tcg-match-01/REPORT.md`) and PP-DATA-TEST-02 §5. Reproducible via `scripts/pp-tcg-match-01-divergence-math.mjs`.
