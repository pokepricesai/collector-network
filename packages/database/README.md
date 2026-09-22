# @collector-network/database

**Status:** shell only. No implementation.

## Responsibility (future)

- Supabase JS client construction (browser and server variants).
- Generated TypeScript types for the shared network database.
- Low-level query helpers for the shared `tcg_*` tables consumed across every
  Collector Network site (including the external PokePrices and MTGPrices
  repositories, which will import equivalent primitives via their own copies
  today).

## Boundary

This package is infrastructure. It exposes typed accessors to the shared
database. It **does not** contain product logic, formatting, ranking,
site-specific joins, or UI concerns.

Higher-level, opinionated read logic lives in `@collector-network/market-data`
or per-site code.

## Non-goals

- No hard-coded credentials.
- No production Supabase connection until a later slice.
- No copy of MTGPrices / PokePrices code — this is a clean rebuild informed by
  them, not a lift.
