# @collector-network/network-config

**Status:** minimal seed — one small constants module. Safe to consume.

## Responsibility

- Canonical game identifiers (`pokemon`, `magic`, `yugioh`, `onepiece`,
  `lorcana`).
- The single source of truth for which sites are in-repo vs external.
- Any other truly cross-site constants that must never drift between apps.

## Boundary

Constants and type definitions only. No I/O, no runtime dependencies, no
framework imports. Safe to import from anywhere.

## Non-goals

- No environment / secrets management.
- No per-game UI theming — public product design is deliberately not shared.
