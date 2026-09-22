# @collector-network/analytics

**Status:** shell only. No implementation.

## Responsibility (future)

- Analytics initialisation (GA4 or successor) with per-site measurement IDs.
- A small canonical event vocabulary that behaves the same across every site
  (search, card view, affiliate outbound, sign-in etc.).
- Safe server / client emit wrappers.

## Boundary

Data plumbing only — sites decide which events they choose to emit and how
they present analytics-derived UI (like popularity indicators).

## Non-goals

- No hard-coded measurement IDs.
- No product-specific tracking dashboards.
