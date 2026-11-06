# CN-STOCK-01 · retailer access benchmark

**Status:** checkpoint complete — probe code + fixture tests + live benchmark against a bounded sample across 3 of 5 candidate retailers. No production migration, no cron, no Discord message, no scheduled recurring check.

## 1. Repository + proposed integration points

- **Repo:** `pokepricesai/collector-network` · remote `https://github.com/pokepricesai/collector-network.git`
- **Branch for this checkpoint:** `cn-stock-01-access-probe` (created from `origin/main @ f40603c`). Unrelated in-flight branches preserved untouched.
- **AGENTS.md / CLAUDE.md:** neither present; followed general monorepo conventions.
- **Proposed integration points for the PILOT (not this checkpoint):**
  - `apps/hub/src/server/stock/` — new module, mirroring `apps/hub/src/server/releases/ingest.ts` (fail-soft fetch, `IngestionResult`-style return, operator-only writes). The `extract.mjs` + `fetch.mjs` + `robots.mjs` modules this checkpoint ships are TypeScript-ready drop-ins.
  - `apps/hub/src/app/api/cron/stock-probe/route.ts` — scheduled worker handler, wrapped with the existing `network_start_job_run` / `network_complete_job_run` RPC pattern (see `apps/hub/src/app/api/cron/releases-ingest/route.ts` as the template). Registered in `apps/hub/vercel.json` **not scheduled during this checkpoint**.
  - `apps/hub/src/app/admin/jobs/` — Jobs admin already surfaces any job writing to `network_job_runs`; no new admin surface needed for v1.
  - `apps/hub/src/app/admin/health/` — Network Health already shows per-job freshness; stock probe will appear automatically once its job name registers.
  - **New Supabase tables (future, not this checkpoint):** `network_stock_watchlist` (listing × current state), `network_stock_events` (append-only state transitions), `network_delivery_outbox` (durable Discord dispatch with `attempt_count`, `next_attempt_at`, `delivered_at`, `idempotency_key`). Shape to mirror the existing `apps/hub/src/server/emails/queue.ts` outbox pattern.
  - **Alerts surface:** existing `network_alerts` table + `/admin/intelligence?status=active` consolidation — stock transitions should emit `level='opportunity'` rows there for the operator-visible audit trail in addition to the Discord push.
  - **Not relevant to reuse:** `network_partners` (CN-06A sponsorship CRM — vendor contacts, not retailer inventory URLs). Keep the stock watchlist separate.

## 2. Retailer results

Live benchmark ran against 6 product URLs across 3 reachable retailers on 2026-11-06. Full artefacts:

- `scripts/_cn-stock-01/out/benchmark-2026-11-06T19-56-01-143Z.json`
- `scripts/_cn-stock-01/out/benchmark-2026-11-06T19-56-01-143Z.csv`

| Retailer | Country | Game | URL | HTTP | Bytes | Duration | Method | Result |
|---|---|---|---|---|---|---|---|---|
| total_cards | UK | pokemon | `/products/black-white-dark-explorers-blister-booster-pack` | 200 | 569,757 | 534ms | none | **unknown** |
| total_cards | UK | pokemon | `/products/black-white-dark-explorers-blister-booster-packs-x4` | 200 | 562,079 | 527ms | none | **unknown** |
| total_cards | UK | pokemon | `/products/hgss-blastoise-checklane-blister-booster-pack` | 200 | 557,892 | 525ms | none | **unknown** |
| game_nerdz | US | mtg | `/magic-the-gathering-streets-of-new-capenna-set-booster-box` | 200 | 153,419 | 594ms | json_ld | **in_stock** USD 219.97 |
| game_nerdz | US | mtg | `/magic-the-gathering-throne-of-eldraine-booster-box` | 200 | 151,874 | 766ms | json_ld | **in_stock** USD 219.97 |
| miniature_market | US | mtg | `/magic-the-gathering-tales-of-middle-earth-set-booster-pack-wocd1523-pack.html` | 200 | 348,139 | 553ms | microdata | **in_stock** |

### Retailers blocked at sitemap discovery (manifest cannot be populated automatically)

| Retailer | Hostname | Evidence | Next-step |
|---|---|---|---|
| magic_madhouse | `www.magicmadhouse.co.uk` | `robots.txt` 200 (no explicit disallow), but `/sitemap.xml`, `/sitemap_index.xml`, `/sitemap_products.xml` all return HTTP 404 with the store's 404 HTML page (607 KB each). Store IS reachable; the sitemap endpoint simply is not published under any of the standard BigCommerce paths. | Operator provides 5–10 direct product URLs, or we file for the BigCommerce `storesitemap.xml` via their merchant feed. |
| chaos_cards | `www.chaoscards.co.uk` | `robots.txt` 200 and advertises `Sitemap: https://www.chaoscards.co.uk/sitemap.xml` + `Crawl-delay: 3`, but `/sitemap.xml` itself returns HTTP 403 (Cloudflare bot challenge; our generic UA is not whitelisted). Product pages behind the same Cloudflare rule-set. | Either Chaos Cards whitelists our identifier, or we accept their merchant-authorised feed, or they're deferred from the pilot. |

### Evidence limitations observed

- **Total Cards (Shopify) truly has no Product-level structured data** on this theme: 3 JSON-LD blocks present (Organization, BreadcrumbList, one empty placeholder), no `og:availability`, no `itemprop="availability"`. Textual signals in the body include `Sold Out: 9 hits`, `Pre-order: 18 hits`, `Add to Cart`, `In Stock: 2 hits` — these come from the related-products rail, upsell widgets, and nav chrome. Per the brief, **page text elsewhere, recommendations or a different available variant must not establish stock** — the probe correctly returned `unknown` for all three listings rather than guessing.
- **Shopify merchant-authorised JSON** (`/products/HANDLE.json`) is reachable on Total Cards (HTTP 200, 4.5 KB payload per product), but the response has `variants[0].available = undefined` — Shopify permits merchants to hide inventory on that endpoint and Total Cards has done so. See recommendation §3.
- **Game Nerdz (BigCommerce) ships clean schema.org JSON-LD** including price + currency + availability; perfect for this pattern. First-class pilot candidate.
- **Miniature Market (Magento 2)** ships microdata `itemprop="availability"` with a schema.org URI — no JSON-LD, but the extractor's fallback path picks it up cleanly.
- **Page sizes range 150 KB – 570 KB** — comfortably under the 2 MB response-size cap. No truncation.
- **Durations 525–766 ms** per request, including TLS + first-byte. Cold cache. Will be faster with a warmed CDN.

## 3. Pilot readiness per retailer

| Retailer | Ready for scheduled pilot? | Rationale |
|---|---|---|
| **game_nerdz** | **Yes, first-wave candidate.** | Clean schema.org JSON-LD on every product page, price + currency extractable, 2/2 in_stock with high confidence. Honours `robots.txt`. No crawl-delay advertised — default 3s per-host politeness is sufficient. |
| **miniature_market** | **Yes, first-wave candidate.** | Microdata path works; results consistent with expected state. Honours `robots.txt`. |
| **total_cards** | **Deferred — needs extraction upgrade.** | Reachable, fast, honours robots.txt + advertises an agents.md policy. But the current theme emits no Product-level structured data on the HTML page. Fix: add a Shopify `.json` secondary extraction path, OR skip stock-state and only track price. Both work through a merchant-authorised interface. See §6 recommendation. |
| **magic_madhouse** | **Blocked pending operator URLs.** | Store reachable; sitemap discovery fails on every standard BigCommerce path. Needs ~5–10 direct product URLs from the operator OR a published sitemap endpoint. |
| **chaos_cards** | **Blocked pending Cloudflare allowlist.** | Robots.txt advertises `/sitemap.xml` but Cloudflare 403s it for our UA. Product pages behind the same rule-set — repeated access without an allowlist would look like scraping. Defer unless we can secure an allowlist or a merchant-authorised feed. |

Pilot verdict: **2 of 5 candidate retailers are immediately pilot-ready**, 1 is fixable with ~1 hour of extraction work, 2 are blocked on operator / merchant-side action.

## 4. Reproducibility

```bash
# Fixture tests (offline, deterministic)
node --test scripts/_cn-stock-01/__tests__/extract.test.mjs

# Live benchmark (reads scripts/_cn-stock-01/manifest.json)
node scripts/_cn-stock-01/probe.mjs

# Or with a different manifest / limit
node scripts/_cn-stock-01/probe.mjs --manifest path/to/manifest.json --limit 3
```

### Test results (2026-11-06, Windows, Node 24.12)

```
node --test scripts/_cn-stock-01/__tests__/extract.test.mjs
  ✔ in_stock via JSON-LD Offer.availability=InStock
  ✔ out_of_stock via JSON-LD (tolerates http:// schema URI)
  ✔ preorder via JSON-LD array wrap + @graph-adjacent BreadcrumbList
  ✔ identity mismatch downgrades a positive signal to unknown
  ✔ conflicting JSON-LD (InStock) + OG (OutOfStock) → unknown
  ✔ no availability signal → unknown with diagnostic
  ✔ malformed JSON-LD block is silently skipped (no crash)
  ✔ microdata availability (link/href) surfaces when JSON-LD absent
  ✔ OpenGraph product:availability catches instock
  ✔ JSON-LD parser skips blocks that fail JSON.parse
  ✔ parseJsonLdBlocks flattens arrays + @graph
  ✔ findProductOffers returns {product, offer} pairs
  ✔ pageTitle collapses whitespace + strips surrounding tags
  ✔ identityMatches: >=60% significant-token overlap passes
  ✔ identityMatches: unrelated product name fails
  ✔ identityMatches returns null when no candidate is available
  ✔ robots: Disallow:/ in the * group blocks everything
  ✔ robots: mixed Allow/Disallow: more specific wins
  ✔ robots: no matching group → everything allowed
  ✔ robots: comments stripped; blank lines ignored
ℹ tests 20 · pass 20 · fail 0
```

### Hub typecheck / existing tests

The probe lives under `scripts/` (ad-hoc tools), not `apps/hub/src/`, so it is not in the Hub's TS compilation unit. For the pilot, when `scripts/_cn-stock-01/*.mjs` is ported into `apps/hub/src/server/stock/*.ts`, the existing `pnpm --filter hub typecheck` + `pnpm --filter hub vitest run` must pass. Not applicable to this checkpoint — the probe code is pure ES modules and runs under Node's native `--test`.

## 5. Cost / quota footprint for the proposed pilot

**Pilot shape (not deployed yet):** 25–50 listings, 5-minute cadence, 5 retailers.

Measured values from this benchmark (6 listings, 1 run):

- Total outbound requests: **6** (one GET per listing). Plus **5** robots.txt fetches (one per unique host, cached after that) and **~4** sitemap-discovery requests already paid off-pipeline.
- Total bytes received across the run: **~2.3 MB** (570k × 3 for Total Cards HTML + 150k × 2 for Game Nerdz + 350k for Miniature Market).
- Wall-clock: **~6 s** (with 3 s politeness delay per host; sequential).

Extrapolated to the proposed pilot (50 listings × 288 fires/day):

| Metric | Measured basis | Daily pilot projection | Monthly projection |
|---|---|---|---|
| Outbound HTTP GETs (product pages) | 1 per listing per fire | 50 × 288 = **14,400** | ~**432 K** |
| Outbound HTTP GETs (robots.txt, cached 24h per host) | 5 fetches / day | 5 | ~150 |
| Vercel function invocations (1 cron fire = 1 invocation that iterates all listings) | 1 per fire | 288 | ~8,640 |
| Payload ingress (bytes, product pages only) | ~350 KB mean | 50 × 288 × 350 KB = **~5 GB/day** | **~150 GB/month** |
| Supabase writes (state-change events only, not every fire) | depends on churn | assume ~5 transitions/day | ~150 rows/month |

**Vercel limits** (team plan, from your earlier audit):
- **Cron fires:** 288/day × 1 cron = well under the plan's cron limit; **ASSUMPTION**: limit is not materially exceeded. **unverified** — operator should confirm current plan allowance before enabling.
- **Function invocations:** 8,640/month is negligible against standard team-plan quotas (~1M+ included). **ASSUMPTION based on standard Vercel plan sizing — unverified in this checkpoint.**
- **Egress:** 150 GB/month is the one metric that merits attention. Within many team plans but not trivial. **unverified against your current usage baseline** — recommend inspecting the Vercel bandwidth meter before enabling the pilot. The pilot WILL hit this ceiling if run daily at 5-min cadence for a month.

**Supabase limits:**
- Writes per month: ~150 transition rows + ~288 × 50 unchanged-state checks (if we log every fire — we should NOT, per §6). Within free tier.
- Storage: trivial (< 1 MB/month for events + outbox at measured churn).

**Honest unverified-quota caveat per the brief:** I did NOT inspect the current Vercel / Supabase usage dashboards to confirm available headroom. Treat all projections as planning numbers, not confirmed free capacity. The £100/month ceiling requires operator confirmation that egress + function invocations fit within the current plan's included quotas before activating the pilot.

## 6. Next milestone (the pilot)

Architecture confirmed against existing Hub conventions:

1. **Schema** (3 new Supabase tables, admin-RLS, mirrors `network_tcg_release_changes` audit pattern):
   - `network_stock_watchlist(id, retailer, country, game, product_name, variant, url, enabled, last_known_state, last_observed_at, last_state_changed_at, consecutive_unknown_count, consecutive_fail_count, created_at, updated_at)`
   - `network_stock_events(id, watchlist_id, observed_at, http_status, duration_ms, bytes, extraction_method, evidence_summary, result)` — append-only, **short retention (30 days)** so the table doesn't bloat.
   - `network_delivery_outbox(id, kind, target, idempotency_key, payload jsonb, attempt_count, next_attempt_at, delivered_at, last_error, created_at)` — Discord webhook delivery; `idempotency_key` prevents duplicate pushes on retries.
2. **Supabase Cron** at 5-minute cadence (or Vercel Cron — either works; Supabase Cron keeps the probe close to its data). Recommend Supabase Cron because:
   - Checks live outside the function invocation count.
   - Natural fit for the existing `network_start_job_run` RPC pattern.
   - Avoids Vercel function timeout worries on a long listing sweep.
3. **Bounded worker** (`/api/cron/stock-probe` or equivalent pg_cron function): fetches up to N watchlist rows per fire, respects per-host `HostGate(3000)`, reuses the fetch + extract modules from this checkpoint.
4. **State machine:**
   - `unknown` → preserves `last_known_state`; increments `consecutive_unknown_count`. After 6 consecutive unknowns the operator gets a "needs re-verification" alert (`network_alerts` level=warning).
   - Transition `out_of_stock → in_stock` → emit `network_stock_events` row + enqueue `network_delivery_outbox` (Discord webhook POST).
   - Duplicate suppression: `idempotency_key = watchlist_id:event_id` — if the same event tries to enqueue twice (retry of a failed worker run), the unique constraint rejects the second insert.
   - Bounded retries: outbox worker fires every 1 minute; each row gets 5 attempts with exponential backoff (1 / 2 / 5 / 15 / 60 minutes) then `last_error` captures and operator sees it on the Jobs page.
5. **Ambiguous-send handling:** webhook POST timeout is explicitly NOT retried — we record `attempt_count++` and `last_error='timeout_ambiguous'`, surface it as a warning on the Jobs page, but do not fire again. A timed-out webhook can have been delivered Discord-side; retrying risks duplicate pushes. Operator judges.
6. **Jobs + Network Health integration:** probe wraps in `network_start_job_run('stock.probe')` / `_complete_job_run`. Outbox wraps in `network_start_job_run('stock.outbox')`. Both appear on `/admin/jobs` and `/admin/health` automatically.
7. **Discord routing:** private test-channel webhook URL during the 48h pilot. Not committed. Stored as an env var on the Hub Vercel project (see §7).
8. **Short event retention:** daily `delete from network_stock_events where observed_at < now() - interval '30 days'` in a Supabase Cron job. Watchlist + delivery outbox retained long-term.
9. **Extraction upgrades needed before pilot:**
   - Add Shopify `/products/HANDLE.json` secondary path. Many Shopify themes (Total Cards' for example) don't emit Product JSON-LD but the merchant-authorised `.json` endpoint is public and structured. Feature-detect: if the host is a Shopify store (HTML meta `<meta name="shopify-digital-wallet" ...>` or similar), try the `.json` endpoint first.
   - Add `<script id="shopify-features"...>` detection as the Shopify sniff — robust against custom domains.

Alternative architecture considered + rejected: a per-retailer bespoke scraper per site. Rejected because: (a) our 2/3 reachable retailers already expose schema.org — generic extractor works; (b) bespoke scrapers rot when retailers change templates; (c) the £0 ceiling is tight and we cannot afford a headless-browser fleet. The generic schema.org-first approach is the correct architecture.

## 7. Missing settings (names only; do not paste values into this doc, commits, or chat)

The pilot will need these env vars added to the Hub Vercel project — `vercel env add` from the operator's machine, never committed:

- `STOCK_PROBE_DISCORD_WEBHOOK` — private test-channel webhook URL for the 48h pilot. Rotate to a production channel afterwards.
- `STOCK_PROBE_ENABLED` — gate flag (`1` to activate the cron; default off so the merge doesn't immediately start probing).
- `STOCK_PROBE_LISTING_CAP` — safety cap (default 50) to bound each cron fire regardless of watchlist size.
- `STOCK_PROBE_PER_HOST_DELAY_MS` — default 3000, matches Chaos Cards' declared `Crawl-delay: 3` (polite ceiling across all hosts).

No other credentials needed. The probe does not authenticate to any retailer and does not use any paid proxy / anti-bot service.

---

## Appendix A — file inventory this checkpoint ships

```
scripts/_cn-stock-01/
├── extract.mjs                       pure extraction (JSON-LD, meta, microdata, identity matching, price)
├── fetch.mjs                         bounded GET (timeout, size cap, allowlist, private-IP guards, manual redirects, HostGate)
├── robots.mjs                        robots.txt parser + cache (User-agent: * group, Allow > Disallow specificity)
├── probe.mjs                         orchestrator: loads manifest, runs fetch+extract, writes JSON+CSV + stdout summary
├── manifest.json                     the current 6-URL sample (3 retailers)
├── out/
│   ├── benchmark-2026-11-06T19-56-01-143Z.json
│   └── benchmark-2026-11-06T19-56-01-143Z.csv
└── __tests__/
    ├── extract.test.mjs              20 Node --test scenarios covering every classifier branch + robots parser
    └── fixtures/
        ├── in_stock_json_ld.html     ~500 B · schema.org InStock + GBP price
        ├── out_of_stock_json_ld.html ~400 B · schema.org OutOfStock + USD price
        ├── preorder_json_ld.html     ~500 B · schema.org PreOrder in array-wrapped graph
        ├── identity_mismatch.html    ~500 B · in-stock signal on a DIFFERENT product + recommendations panel mentioning target
        ├── conflicting_signals.html  ~500 B · JSON-LD InStock + og:availability OutOfStock
        ├── no_signal.html            ~300 B · page with no availability markup
        ├── malformed_json_ld.html    ~300 B · truncated JSON-LD block
        ├── microdata_in_stock.html   ~500 B · itemprop="availability" href="…/InStock"
        └── opengraph_in_stock.html   ~300 B · <meta property="product:availability" content="instock">

docs/network/
└── CN-STOCK-01-access-benchmark.md   this file
```

No application source code modified. No migration files created. No cron registered. No deployment triggered. No Discord message sent.
