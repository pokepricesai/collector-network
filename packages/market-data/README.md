# @collector-network/market-data

**Status:** shell only. No implementation.

## Responsibility (future)

- Shared **read** logic for the market and graded price tables:
  `tcg_market_prices_current`, `tcg_market_price_daily`,
  `tcg_graded_prices_current`, `tcg_graded_price_daily`.
- Common concepts: latest price, daily history windows, movers, condition
  and grade normalisation.

## Boundary

Read-only. Ingestion (scraping, external APIs, ETL) lives elsewhere and is
out of scope for this repository.

Presentation is intentionally per-site. This package returns data; each site
decides how to render, phrase, and rank it.

## Non-goals

- No cross-game "generic card widget". Sites design their own components on
  top of this data.
- No copy of MTGPrices / PokePrices code — it will be rewritten cleanly.
