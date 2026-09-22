# @collector-network/affiliate

**Status:** shell only. No implementation.

## Responsibility (future)

- eBay Partner Network link construction and campaign / sub-id tagging.
- Click tracking hooks common to every network site.
- Any additional affiliate network wiring (TCGplayer, etc.) as decisions are
  made per-game.

## Boundary

Infrastructure only. Presentation of affiliate CTAs is entirely per-site.
This package does not export UI.

## Non-goals

- No hard-coded campaign IDs in source; they live in env / network-config.
